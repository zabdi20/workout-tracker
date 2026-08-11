import type { Cycle } from '../db/types';

/** Positive modulo, so a negative or oversized index still lands in range. */
function wrap(index: number, length: number): number {
  if (length === 0) return 0;
  return ((index % length) + length) % length;
}

export function nextRoutineId(cycle: Cycle): string | null {
  if (cycle.routineIds.length === 0) return null;
  return cycle.routineIds[wrap(cycle.currentIndex, cycle.routineIds.length)];
}

/**
 * The spec's advancement rule: completing routine R sets currentIndex to
 * position(R) + 1. Doing a routine out of order re-anchors the cycle there
 * rather than leaving it permanently out of sync with what was trained.
 */
export function advanceAfter(cycle: Cycle, routineId: string): Cycle {
  const position = cycle.routineIds.indexOf(routineId);
  if (position === -1) return cycle;
  return { ...cycle, currentIndex: wrap(position + 1, cycle.routineIds.length) };
}

export function skipNext(cycle: Cycle): Cycle {
  if (cycle.routineIds.length === 0) return cycle;
  return { ...cycle, currentIndex: wrap(cycle.currentIndex + 1, cycle.routineIds.length) };
}

export function withoutRoutine(cycle: Cycle, routineId: string): Cycle {
  // Normalise first: currentIndex may be out of range, and slice() would
  // otherwise clamp an oversized index to the whole array or reinterpret a
  // negative one as counting from the end. Both silently mis-count.
  const pointer = wrap(cycle.currentIndex, cycle.routineIds.length);

  // Removing an occurrence before the pointer shifts every later element
  // down by one. Without this adjustment the pointer keeps its numeric
  // index and silently lands on a different routine.
  const removedBefore = cycle.routineIds
    .slice(0, pointer)
    .filter((id) => id === routineId).length;

  const routineIds = cycle.routineIds.filter((id) => id !== routineId);
  if (routineIds.length === 0) return { ...cycle, routineIds, currentIndex: 0 };

  return {
    ...cycle,
    routineIds,
    currentIndex: wrap(pointer - removedBefore, routineIds.length),
  };
}
