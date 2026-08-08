import { db } from './db';
import type { Routine, RoutineItem } from './types';

export async function listRoutines(
  opts: { includeArchived?: boolean } = {},
): Promise<Routine[]> {
  // toArray + in-memory filter, never .where('isArchived') — IndexedDB
  // cannot key booleans, so the schema deliberately leaves it unindexed.
  const all = await db.routines.toArray();
  const visible = opts.includeArchived ? all : all.filter((r) => !r.isArchived);
  return visible.sort((a, b) => a.name.localeCompare(b.name));
}

export function getRoutine(id: string): Promise<Routine | undefined> {
  return db.routines.get(id);
}

export async function createRoutine(name: string): Promise<Routine> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Routine name is required');

  const now = Date.now();
  const routine: Routine = {
    id: crypto.randomUUID(),
    name: trimmed,
    items: [],
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.routines.add(routine);
  return routine;
}

export async function renameRoutine(id: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Routine name is required');
  await db.routines.update(id, { name: trimmed, updatedAt: Date.now() });
}

export async function setRoutineItems(
  id: string,
  items: RoutineItem[],
): Promise<void> {
  await db.routines.update(id, { items, updatedAt: Date.now() });
}

/**
 * Archives rather than deletes. A hard delete would orphan every Session
 * whose routineId points here.
 */
export async function archiveRoutine(id: string): Promise<void> {
  await db.routines.update(id, { isArchived: true, updatedAt: Date.now() });
}

export async function unarchiveRoutine(id: string): Promise<void> {
  await db.routines.update(id, { isArchived: false, updatedAt: Date.now() });
}
