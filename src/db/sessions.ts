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
 *
 * Finishing a session that is already completed is a silent no-op, the same
 * way startSession returns the open session instead of starting another. A
 * double-tap on Finish, or a stale screen finishing a workout History has
 * since shown, would otherwise re-stamp endedAt (rewriting a past workout's
 * duration) and advance the rotation a second time.
 */
export async function finishSession(id: string): Promise<void> {
  await db.transaction('rw', db.sessions, db.cycles, async () => {
    const session = await db.sessions.get(id);
    if (!session) throw new Error('Session not found');
    if (session.status === 'completed') return;

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

/**
 * Every finished workout, newest first by start time.
 *
 * `status` is an indexed string, so .where() is correct here. The workout in
 * progress is left out on purpose: it has its own way in from Today, and
 * History must not become a second route into editing the live session.
 *
 * Read-only, so this is safe to call from inside a useLiveQuery querier.
 */
export async function listCompletedSessions(): Promise<Session[]> {
  const done = await db.sessions.where('status').equals('completed').toArray();
  return done.sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * Moves a finished workout so it started at `newStartedAt`, shifting its
 * end time and every one of its sets by the same amount.
 *
 * The sets MUST move with the session. The "last time" prefill and personal
 * record order both read each set's completedAt, so moving only the session
 * would leave both pointing at the wrong workout with nothing visibly wrong.
 *
 * Takes the new ABSOLUTE start time rather than a shift. The shift is
 * computed here, inside the transaction, from a fresh read of startedAt: one
 * computed at render time would be applied twice by a double-tapped Save,
 * whereas the second call here finds the workout already there and does
 * nothing.
 *
 * A time in the same minute as the current start is a no-op. The date-and-time
 * input carries no seconds, so an untouched field arrives as the start time
 * with its seconds dropped, and honouring it would shift the workout by those
 * seconds.
 *
 * A workout cannot be moved so that it ends in the future.
 *
 * NEVER call this from inside a useLiveQuery querier: it opens a readwrite
 * transaction and Dexie throws ReadOnlyError.
 */
export async function moveSession(id: string, newStartedAt: number): Promise<void> {
  await db.transaction('rw', db.sessions, db.sets, async () => {
    const session = await db.sessions.get(id);
    if (!session) throw new Error('Workout not found');
    if (session.status === 'in_progress') {
      throw new Error('The workout in progress cannot be moved');
    }

    if (Math.floor(newStartedAt / 60_000) === Math.floor(session.startedAt / 60_000)) return;

    const delta = newStartedAt - session.startedAt;
    if ((session.endedAt ?? session.startedAt) + delta > Date.now()) {
      throw new Error('A workout cannot be moved into the future');
    }

    await db.sessions.update(id, {
      startedAt: session.startedAt + delta,
      ...(session.endedAt !== undefined ? { endedAt: session.endedAt + delta } : {}),
    });
    await db.sets.where('sessionId').equals(id).modify((s) => {
      s.completedAt += delta;
    });
  });
}

/**
 * Deletes a finished workout and its sets, in one transaction.
 *
 * Refuses a session still in progress, which has discardSession and its
 * confirmation. Leaves the rotation exactly where it is: rewinding which
 * routine is next because an old workout was deleted would surprise far more
 * often than it would help, so cycles is not part of this transaction.
 *
 * An id that no longer exists is not an error. Like discardSession this is
 * idempotent, so a double-tapped Delete cannot fail on its second call after
 * the first has already done the job.
 *
 * NEVER call this from inside a useLiveQuery querier: it opens a readwrite
 * transaction and Dexie throws ReadOnlyError.
 */
export async function deleteCompletedSession(id: string): Promise<void> {
  await db.transaction('rw', db.sessions, db.sets, async () => {
    const session = await db.sessions.get(id);
    if (session?.status === 'in_progress') {
      throw new Error('The workout in progress cannot be deleted here; discard it instead');
    }

    await db.sets.where('sessionId').equals(id).delete();
    await db.sessions.delete(id);
  });
}
