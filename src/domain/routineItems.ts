import type { RoutineItem } from '../db/types';

/** Renumbers `order` contiguously from 0, preserving array order. */
function renumber(items: RoutineItem[]): RoutineItem[] {
  return items.map((item, index) => ({ ...item, order: index }));
}

export function addItem(
  items: RoutineItem[],
  exerciseId: string,
  id: string,
): RoutineItem[] {
  return renumber([...items, { id, exerciseId, order: items.length }]);
}

export function removeItem(items: RoutineItem[], itemId: string): RoutineItem[] {
  return renumber(items.filter((item) => item.id !== itemId));
}

export function moveItem(
  items: RoutineItem[],
  itemId: string,
  direction: 'up' | 'down',
): RoutineItem[] {
  const index = items.findIndex((item) => item.id === itemId);
  if (index === -1) return renumber(items);

  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= items.length) return renumber(items);

  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return renumber(next);
}

/** The per-item target: "4 x 6-8, 2 min rest". */
export interface Prescription {
  targetSets?: number;
  targetRepMin?: number;
  targetRepMax?: number;
  restSeconds?: number;
}

const FIELDS: Array<keyof Prescription> = [
  'targetSets', 'targetRepMin', 'targetRepMax', 'restSeconds',
];

/**
 * Merges a prescription patch into one item.
 *
 * A cleared field deletes its key rather than storing `undefined`. Both
 * round-trip through IndexedDB, but an absent key is what every reader
 * already tests for, and it keeps exported backups free of null-ish noise.
 */
export function setItemPrescription(
  items: RoutineItem[],
  itemId: string,
  patch: Prescription,
): RoutineItem[] {
  return items.map((item) => {
    if (item.id !== itemId) return item;

    const next: RoutineItem = { ...item };
    for (const field of FIELDS) {
      if (!(field in patch)) continue;
      const value = patch[field];
      if (value === undefined) delete next[field];
      else next[field] = value;
    }
    return next;
  });
}

/**
 * Returns an error message, or null when the patch is storable.
 *
 * Pure and separate from the write so the editor can show the problem
 * without a database round-trip, and so the rules are testable without one.
 */
export function validatePrescription(patch: Prescription): string | null {
  for (const field of FIELDS) {
    const value = patch[field];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 1) {
      return 'Targets must be a whole number of 1 or more.';
    }
  }

  const { targetRepMin: min, targetRepMax: max } = patch;
  if (min !== undefined && max !== undefined && min > max) {
    return 'The rep range runs backwards — the low end must not exceed the high end.';
  }

  return null;
}
