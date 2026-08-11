import { db } from './db';
import { withoutRoutine } from '../domain/cycle';
import type { Cycle } from './types';

/**
 * Returns the active cycle, creating an empty one on first use.
 *
 * The check and the insert run in one transaction. React StrictMode
 * double-invokes effects in development, so without it two calls can both
 * observe an empty table and create a second cycle.
 */
export async function getOrCreateActiveCycle(): Promise<Cycle> {
  return db.transaction('rw', db.cycles, async () => {
    // toArray + in-memory find, never .where('isActive') — IndexedDB cannot
    // key booleans, so the schema deliberately leaves it unindexed.
    const all = await db.cycles.toArray();
    const active = all.find((c) => c.isActive);
    if (active) return active;

    const cycle: Cycle = {
      id: crypto.randomUUID(),
      name: 'Current split',
      routineIds: [],
      currentIndex: 0,
      isActive: true,
    };
    await db.cycles.add(cycle);
    return cycle;
  });
}

export async function saveCycle(cycle: Cycle): Promise<void> {
  await db.cycles.put(cycle);
}

/**
 * Keeps cycles referentially clean when a routine is archived. Without this
 * an archived routine would keep coming up as "next" with no way to train it.
 */
export async function removeRoutineFromAllCycles(routineId: string): Promise<void> {
  await db.transaction('rw', db.cycles, async () => {
    const all = await db.cycles.toArray();
    for (const cycle of all) {
      if (!cycle.routineIds.includes(routineId)) continue;
      await db.cycles.put(withoutRoutine(cycle, routineId));
    }
  });
}
