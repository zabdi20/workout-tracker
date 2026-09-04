import { db } from './db';
import { advanceAfter } from '../domain/cycle';
import type { Routine, Session } from './types';

/**
 * The one session currently being logged, if any.
 *
 * `status` is a string and IS indexed, so .where() is correct here — the
 * never-.where() rule covers booleans and nulls. Session.routineId is the
 * nullable field on this table and stays unindexed.
 *
 * Read-only, so this is safe to call from inside a useLiveQuery querier.
 *
 * Sorted by startedAt rather than taken with .first(), which would return
 * the lowest primary key among matches. At most one session is ever in
 * progress, so this only matters if that invariant is ever broken — in
 * which case resuming the oldest is the predictable answer.
 */
export async function getInProgressSession(): Promise<Session | undefined> {
  const open = await db.sessions.where('status').equals('in_progress').sortBy('startedAt');
  return open[0];
}

export function getSession(id: string): Promise<Session | undefined> {
  return db.sessions.get(id);
}

/**
 * Starts logging `routine`, or returns the session already in progress for
 * it.
 *
 * The check and the insert share one transaction, for the same reason
 * getOrCreateActiveCycle does: StrictMode double-invokes effects and a
 * double-tap on Start is the same race, so two calls can both observe an
 * empty table before either writes.
 *
 * Returning the existing session makes a repeat call idempotent. Throwing
 * for a *different* routine keeps that from silently handing the caller a
 * session they did not ask for — the Today screen shows Resume rather than
 * Start while one is open, so reaching this is already a bug.
 *
 * NEVER call this from inside a useLiveQuery querier: it opens a readwrite
 * transaction and Dexie throws ReadOnlyError.
 */
export async function startSession(routine: Routine): Promise<Session> {
  return db.transaction('rw', db.sessions, async () => {
    const open = await db.sessions.where('status').equals('in_progress').sortBy('startedAt');
    const existing = open[0];
    if (existing) {
      if (existing.routineId === routine.id) return existing;
      throw new Error(
        `A session is already in progress: ${existing.name}. Finish or discard it first.`,
      );
    }

    const session: Session = {
      id: crypto.randomUUID(),
      routineId: routine.id,
      // Snapshotted, so renaming the routine later does not rewrite history.
      name: routine.name,
      startedAt: Date.now(),
      status: 'in_progress',
    };
    await db.sessions.add(session);
    return session;
  });
}

/**
 * Marks the session complete and advances the rotation, in one transaction.
 *
 * The two must not be separable: a failure between them leaves a completed
 * session sitting behind a stale rotation pointer, and the user would train
 * the same routine twice without the app noticing.
 *
 * A routine archived mid-session needs no special case. archiveRoutine
 * strips it from every cycle, and advanceAfter returns the cycle unchanged
 * when indexOf is -1.
 */
export async function finishSession(id: string): Promise<void> {
  await db.transaction('rw', db.sessions, db.cycles, async () => {
    const session = await db.sessions.get(id);
    if (!session) throw new Error('Session not found');

    await db.sessions.update(id, { endedAt: Date.now(), status: 'completed' });

    // Freestyle sessions have no routine to advance past. No UI creates one
    // yet, but the schema permits it and this is the natural place to be
    // correct about it.
    if (session.routineId === null) return;

    const cycles = await db.cycles.toArray();
    const active = cycles.find((c) => c.isActive);
    if (!active) return;

    await db.cycles.put(advanceAfter(active, session.routineId));
  });
}

/**
 * Deletes the session and its sets.
 *
 * A real hard delete, and a correct one. The never-hard-delete rule protects
 * rows that other rows reference; nothing references a Session except the
 * LoggedSets that go with it, and both are removed here in one transaction.
 * An 'abandoned' status was considered and rejected — it buys nothing and
 * would make History filter for it forever.
 */
export async function discardSession(id: string): Promise<void> {
  await db.transaction('rw', db.sessions, db.sets, async () => {
    await db.sets.where('sessionId').equals(id).delete();
    await db.sessions.delete(id);
  });
}
