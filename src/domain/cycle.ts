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

/**
 * 1-based position of the current routine within the rotation, for display.
 * Returns 0 for an empty cycle. Normalises through wrap() so an out-of-range
 * currentIndex cannot render a zero or negative position — the same
 * normalisation nextRoutineId already applies when picking the routine.
 */
export function cyclePosition(cycle: Cycle): number {
  if (cycle.routineIds.length === 0) return 0;
  return wrap(cycle.currentIndex, cycle.routineIds.length) + 1;
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

/**
 * Removes the rotation slot at `index`, keeping the pointer on the routine it
 * was already on. Removing an earlier slot shifts later ones down, so the
 * pointer moves with them; removing the pointed-at slot leaves the pointer in
 * place, which then lands on whatever followed.
 *
 * Index-based, unlike withoutRoutine, because a routine may occupy several
 * slots and the user removed one specific slot.
 */
export function withoutSlot(cycle: Cycle, index: number): Cycle {
  const routineIds = cycle.routineIds.filter((_, i) => i !== index);
  if (routineIds.length === 0) return { ...cycle, routineIds, currentIndex: 0 };

  const pointer = wrap(cycle.currentIndex, cycle.routineIds.length);
  const shifted = index < pointer ? pointer - 1 : pointer;
  return { ...cycle, routineIds, currentIndex: wrap(shifted, routineIds.length) };
}

/**
 * Swaps the slot at `index` with its neighbour, carrying the pointer with the
 * slot it was on. Out-of-range moves are a no-op, returning the cycle
 * unchanged so callers can skip a pointless write.
 */
export function moveSlot(cycle: Cycle, index: number, direction: 'up' | 'down'): Cycle {
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= cycle.routineIds.length) return cycle;

  const routineIds = [...cycle.routineIds];
  [routineIds[index], routineIds[target]] = [routineIds[target], routineIds[index]];

  const pointer = wrap(cycle.currentIndex, cycle.routineIds.length);
  const currentIndex = pointer === index ? target : pointer === target ? index : pointer;
  return { ...cycle, routineIds, currentIndex };
}
