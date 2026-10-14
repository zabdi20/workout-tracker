import Dexie from 'dexie';
import { db } from './db';
import type { LoggedSet, SetType, WeightUnit } from './types';

/** Everything a caller supplies; id, order and completedAt are assigned here. */
export interface NewLoggedSet {
  sessionId: string;
  exerciseId: string;
  setType: SetType;
  unit: WeightUnit;
  weight?: number;
  reps?: number;
  durationSeconds?: number;
  distanceMeters?: number;
  notes?: string;
}

/**
 * All sets logged into a session, ordered.
 *
 * `order` is per (session, exercise) and is a monotonic sort key, not a
 * position — deleting a set leaves a gap on purpose. Display numbering is
 * the position within the sorted array, so it stays 1, 2, 3 after a delete.
 */
export async function listSetsForSession(sessionId: string): Promise<LoggedSet[]> {
  const sets = await db.sets.where('sessionId').equals(sessionId).toArray();
  return sets.sort((a, b) => a.order - b.order || a.completedAt - b.completedAt);
}

/**
 * Writes a performed set.
 *
 * `order` is computed inside the transaction from a fresh read, never from
 * an array captured at render. Two fast taps on the same confirm button
 * would otherwise both compute the same number — the Plan 2 stale-array
 * finding, which costs a reorder in a routine list and a logged set here.
 *
 * max(order) + 1 rather than a count: counting would collide with surviving
 * rows after a set is deleted from the middle.
 */
export async function logSet(input: NewLoggedSet): Promise<LoggedSet> {
  return db.transaction('rw', db.sets, async () => {
    const existing = await db.sets
      .where('sessionId')
      .equals(input.sessionId)
      .filter((s) => s.exerciseId === input.exerciseId)
      .toArray();

    const order = existing.reduce((max, s) => Math.max(max, s.order + 1), 0);

    const set: LoggedSet = {
      ...input,
      id: crypto.randomUUID(),
      order,
      completedAt: Date.now(),
    };
    await db.sets.add(set);
    return set;
  });
}

export async function updateSet(id: string, changes: Partial<LoggedSet>): Promise<void> {
  // Dexie turns an `id` inside an update payload into delete-then-add under
  // the new key. That is a real hard delete. Mirrors updateExercise.
  const { id: _discardedId, ...safe } = changes;
  await db.sets.update(id, safe);
}

export async function deleteSet(id: string): Promise<void> {
  await db.sets.delete(id);
}

/**
 * What the user did the last time they trained this exercise, excluding the
 * session currently in progress. Returns that session's sets for this
 * exercise, ordered, or an empty array if there is no history.
 *
 * The hottest query in the app: it renders for every exercise of every
 * workout. Served by the compound [exerciseId+completedAt] index.
 *
 * Two indexed reads rather than one. The obvious single pass — walk
 * backwards collecting until sessionId changes — assumes a session's sets
 * are contiguous in completedAt order. Editing a past session in Plan 5
 * breaks that assumption, and the symptom would be a silently truncated
 * last-time line that nobody connects back to the edit.
 *
 * Sets from different sessions that share a completedAt millisecond make
 * which session wins arbitrary: [exerciseId+completedAt] then ties on
 * primary key, which is a random UUID. Unreachable in real use, where sets
 * are minutes apart, and there is no natural tiebreak to add — a test that
 * seeds several sessions in one go must stamp completedAt itself.
 */
export async function lastPerformance(
  exerciseId: string,
  excludeSessionId: string,
): Promise<LoggedSet[]> {
  const newest = await db.sets
    .where('[exerciseId+completedAt]')
    .between([exerciseId, Dexie.minKey], [exerciseId, Dexie.maxKey])
    .reverse()
    .filter((s) => s.sessionId !== excludeSessionId)
    .first();

  if (!newest) return [];

  const sets = await db.sets
    .where('sessionId')
    .equals(newest.sessionId)
    .filter((s) => s.exerciseId === exerciseId)
    .toArray();

  return sets.sort((a, b) => a.order - b.order);
}

/**
 * Every set ever logged for an exercise, across all workouts, oldest first.
 *
 * Served by the compound [exerciseId+completedAt] index, the same range
 * lastPerformance walks, so the order comes from the index rather than a
 * sort. Includes warm-ups and the workout in progress: deciding what counts
 * is the caller's job.
 *
 * Read-only, so this is safe to call from inside a useLiveQuery querier.
 */
export async function listSetsForExercise(exerciseId: string): Promise<LoggedSet[]> {
  return db.sets
    .where('[exerciseId+completedAt]')
    .between([exerciseId, Dexie.minKey], [exerciseId, Dexie.maxKey])
    .toArray();
}

/**
 * Every set in the database, in no particular order.
 *
 * For screens that summarise all workouts at once, such as History's PR
 * counts per row. One read, so a screen's single querier can hold it.
 *
 * Read-only, so this is safe to call from inside a useLiveQuery querier.
 */
export function listAllSets(): Promise<LoggedSet[]> {
  return db.sets.toArray();
}

/**
 * Adds a set the user forgot to log, to a workout that is already over.
 *
 * It must sort inside the workout it belongs to. "Last time" and personal
 * record order both read completedAt, so stamping the real clock here would
 * file a set from last month under today. It takes the millisecond right
 * after that exercise's latest set in this workout instead, and the next
 * `order` for that exercise, both computed inside the transaction from a
 * fresh read, as logSet does.
 *
 * Refuses an exercise with no sets in the workout: a past workout's exercise
 * list is derived from its sets, so there is no earlier set to sit after, and
 * adding a new exercise to a past workout is out of scope.
 *
 * NEVER call this from inside a useLiveQuery querier: it opens a readwrite
 * transaction and Dexie throws ReadOnlyError.
 */
export async function addForgottenSet(input: NewLoggedSet): Promise<LoggedSet> {
  return db.transaction('rw', db.sets, async () => {
    const existing = await db.sets
      .where('sessionId')
      .equals(input.sessionId)
      .filter((s) => s.exerciseId === input.exerciseId)
      .toArray();

    if (existing.length === 0) throw new Error('This exercise is not in that workout');

    const set: LoggedSet = {
      ...input,
      id: crypto.randomUUID(),
      order: existing.reduce((max, s) => Math.max(max, s.order), -1) + 1,
      completedAt: existing.reduce((max, s) => Math.max(max, s.completedAt), 0) + 1,
    };
    await db.sets.add(set);
    return set;
  });
}
