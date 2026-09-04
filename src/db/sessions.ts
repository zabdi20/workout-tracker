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
