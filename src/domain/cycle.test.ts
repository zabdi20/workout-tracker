import {
  nextRoutineId, advanceAfter, skipNext, withoutRoutine, cyclePosition,
  withoutSlot, moveSlot,
} from './cycle';
import type { Cycle } from '../db/types';

function cycle(routineIds: string[], currentIndex = 0): Cycle {
  return { id: 'c1', name: 'Current split', routineIds, currentIndex, isActive: true };
}

describe('nextRoutineId', () => {
  it('returns the routine at the current index', () => {
    expect(nextRoutineId(cycle(['push', 'pull', 'legs'], 1))).toBe('pull');
  });

  it('returns null for an empty cycle', () => {
    expect(nextRoutineId(cycle([]))).toBeNull();
  });

  it('wraps an out-of-range index rather than returning undefined', () => {
    // 5 mod 2 === 1, so this lands on 'pull', not undefined/a crash.
    // (Brief's literal said 'push' here; that's mathematically inconsistent
    // with the adjacent "wraps a negative index" test below — see report.)
    expect(nextRoutineId(cycle(['push', 'pull'], 5))).toBe('pull');
  });

  it('wraps a negative index', () => {
    expect(nextRoutineId(cycle(['push', 'pull'], -1))).toBe('pull');
  });
});

describe('advanceAfter', () => {
  it('moves to the position after the completed routine', () => {
    expect(advanceAfter(cycle(['push', 'pull', 'legs'], 0), 'push').currentIndex).toBe(1);
  });

  it('wraps past the end', () => {
    expect(advanceAfter(cycle(['push', 'pull'], 1), 'pull').currentIndex).toBe(0);
  });

  it('re-anchors when a routine is done out of order', () => {
    // Cycle expects push, but legs was done. Next should be whatever
    // follows legs, not whatever follows push.
    expect(advanceAfter(cycle(['push', 'pull', 'legs'], 0), 'legs').currentIndex).toBe(0);
  });

  it('leaves the cycle unchanged for a routine not in it', () => {
    const before = cycle(['push', 'pull'], 1);
    expect(advanceAfter(before, 'yoga')).toEqual(before);
  });

  it('leaves an empty cycle unchanged', () => {
    const before = cycle([]);
    expect(advanceAfter(before, 'push')).toEqual(before);
  });

  it('does not mutate the input', () => {
    const before = cycle(['push', 'pull'], 0);
    advanceAfter(before, 'push');
    expect(before.currentIndex).toBe(0);
  });
});

describe('skipNext', () => {
  it('advances one position', () => {
    expect(skipNext(cycle(['push', 'pull', 'legs'], 0)).currentIndex).toBe(1);
  });

  it('wraps past the end', () => {
    expect(skipNext(cycle(['push', 'pull'], 1)).currentIndex).toBe(0);
  });

  it('leaves an empty cycle unchanged', () => {
    const before = cycle([]);
    expect(skipNext(before)).toEqual(before);
  });

  it('does not mutate the input', () => {
    const before = cycle(['push', 'pull'], 0);
    skipNext(before);
    expect(before.currentIndex).toBe(0);
  });
});

describe('withoutRoutine', () => {
  it('removes every occurrence', () => {
    expect(withoutRoutine(cycle(['push', 'pull', 'push'], 0), 'push').routineIds)
      .toEqual(['pull']);
  });

  it('clamps currentIndex when it would fall off the end', () => {
    const result = withoutRoutine(cycle(['push', 'pull'], 1), 'pull');
    expect(result.routineIds).toEqual(['push']);
    expect(result.currentIndex).toBe(0);
  });

  it('resets currentIndex to 0 when the cycle empties', () => {
    const result = withoutRoutine(cycle(['push'], 0), 'push');
    expect(result.routineIds).toEqual([]);
    expect(result.currentIndex).toBe(0);
  });

  it('does not mutate the input', () => {
    const before = cycle(['push', 'pull'], 0);
    withoutRoutine(before, 'push');
    expect(before.routineIds).toEqual(['push', 'pull']);
  });

  it('keeps the pointer on the same routine when an earlier one is removed', () => {
    const result = withoutRoutine(cycle(['push', 'pull', 'legs'], 2), 'push');
    expect(result.routineIds).toEqual(['pull', 'legs']);
    expect(result.currentIndex).toBe(1);
    expect(nextRoutineId(result)).toBe('legs');
  });

  it('accounts for every earlier occurrence when a routine repeats', () => {
    // Covers the removed-before-pointer adjustment with a repeated routine.
    // Does NOT discriminate the later pointer-normalisation fix: currentIndex
    // is already in range here, so wrap() is the identity and both versions
    // agree. Kept as coverage of the adjustment itself.
    const result = withoutRoutine(cycle(['push', 'push', 'legs', 'arms', 'core'], 3), 'push');
    expect(result.routineIds).toEqual(['legs', 'arms', 'core']);
    expect(nextRoutineId(result)).toBe('arms');
  });

  it('keeps the pointer sensible when the pointed-at routine is removed', () => {
    // Pointer sits on the SECOND 'push'; one earlier occurrence is also
    // removed. Like the test above, this exercises the adjustment but not
    // the pointer normalisation — currentIndex is in range, so wrap() is
    // the identity. The two out-of-range tests below cover normalisation.
    const result = withoutRoutine(cycle(['push', 'pull', 'push', 'legs'], 2), 'push');
    expect(result.routineIds).toEqual(['pull', 'legs']);
    expect(nextRoutineId(result)).toBe('legs');
  });

  it('normalises an oversized currentIndex before counting', () => {
    // Logical pointer is wrap(10,3)=1 -> 'pull'; it must stay on 'pull'.
    const result = withoutRoutine(cycle(['push', 'pull', 'legs'], 10), 'push');
    expect(nextRoutineId(result)).toBe('pull');
  });

  it('normalises a negative currentIndex before counting', () => {
    // Logical pointer is wrap(-1,3)=2 -> 'legs'; it must stay on 'legs'.
    const result = withoutRoutine(cycle(['push', 'pull', 'legs'], -1), 'push');
    expect(nextRoutineId(result)).toBe('legs');
  });
});

describe('cyclePosition', () => {
  it('is 1-based', () => {
    expect(cyclePosition(cycle(['push', 'pull', 'legs'], 0))).toBe(1);
    expect(cyclePosition(cycle(['push', 'pull', 'legs'], 2))).toBe(3);
  });

  it('returns 0 for an empty cycle', () => {
    expect(cyclePosition(cycle([]))).toBe(0);
  });

  it('never returns zero or negative for a negative index', () => {
    expect(cyclePosition(cycle(['push', 'pull', 'legs'], -1))).toBe(3);
    expect(cyclePosition(cycle(['push', 'pull', 'legs'], -5))).toBe(2);
  });

  it('never exceeds the rotation length for an oversized index', () => {
    expect(cyclePosition(cycle(['push', 'pull', 'legs'], 10))).toBe(2);
    expect(cyclePosition(cycle(['push', 'pull'], 99))).toBe(2);
  });
});

describe('withoutSlot', () => {
  it('removing a slot before the pointer shifts the pointer down with it', () => {
    // pointer sits on 'legs' (index 2). Removing index 0 ('push') shifts
    // everything down by one, so the pointer must move to keep pointing at
    // 'legs'.
    const result = withoutSlot(cycle(['push', 'pull', 'legs'], 2), 0);
    expect(result.routineIds).toEqual(['pull', 'legs']);
    expect(result.currentIndex).toBe(1);
    expect(nextRoutineId(result)).toBe('legs');
  });

  it('removing the pointed-at slot leaves the pointer in place, landing on the next slot', () => {
    // pointer sits on index 1 ('pull'). Removing index 1 itself: the pointer
    // stays numerically at 1, which after deletion is 'legs'.
    const result = withoutSlot(cycle(['push', 'pull', 'legs'], 1), 1);
    expect(result.routineIds).toEqual(['push', 'legs']);
    expect(result.currentIndex).toBe(1);
    expect(nextRoutineId(result)).toBe('legs');
  });

  it('removing a slot after the pointer leaves the pointer untouched', () => {
    const result = withoutSlot(cycle(['push', 'pull', 'legs'], 0), 2);
    expect(result.routineIds).toEqual(['push', 'pull']);
    expect(result.currentIndex).toBe(0);
    expect(nextRoutineId(result)).toBe('push');
  });

  it('resets currentIndex to 0 when removing the last remaining slot', () => {
    const result = withoutSlot(cycle(['push'], 0), 0);
    expect(result.routineIds).toEqual([]);
    expect(result.currentIndex).toBe(0);
  });

  it('removing one occurrence of a duplicated routine leaves the other slot untouched', () => {
    // Two slots both point at 'push'. Removing slot 0 must not affect slot 1
    // (now slot 0) or the routine as a whole -- only that one specific slot.
    const result = withoutSlot(cycle(['push', 'pull', 'push'], 0), 0);
    expect(result.routineIds).toEqual(['pull', 'push']);
  });

  it('wraps the pointer through an out-of-range currentIndex before adjusting', () => {
    // Logical pointer is wrap(10, 3) = 1 -> 'pull'. Removing index 0 ('push')
    // must still leave the pointer on 'pull'.
    const result = withoutSlot(cycle(['push', 'pull', 'legs'], 10), 0);
    expect(nextRoutineId(result)).toBe('pull');
  });

  it('does not mutate the input', () => {
    const before = cycle(['push', 'pull', 'legs'], 1);
    withoutSlot(before, 0);
    expect(before.routineIds).toEqual(['push', 'pull', 'legs']);
    expect(before.currentIndex).toBe(1);
  });
});

describe('moveSlot', () => {
  it('moving the pointed-at slot carries the pointer with it', () => {
    // pointer sits on index 1 ('pull'). Moving it up swaps it with 'push';
    // the pointer must follow 'pull' to its new position, index 0.
    const result = moveSlot(cycle(['push', 'pull', 'legs'], 1), 1, 'up');
    expect(result.routineIds).toEqual(['pull', 'push', 'legs']);
    expect(result.currentIndex).toBe(0);
    expect(nextRoutineId(result)).toBe('pull');
  });

  it('moving a slot the pointer is not on leaves the pointer\'s routine unchanged', () => {
    // pointer sits on index 0 ('push'). Moving 'legs' (index 2) up swaps it
    // with 'pull'; the pointer must still resolve to 'push'.
    const result = moveSlot(cycle(['push', 'pull', 'legs'], 0), 2, 'up');
    expect(result.routineIds).toEqual(['push', 'legs', 'pull']);
    expect(result.currentIndex).toBe(0);
    expect(nextRoutineId(result)).toBe('push');
  });

  it('moving the slot the pointer swaps with also relocates the pointer', () => {
    // pointer sits on index 2 ('legs'), which is the target of moving index 1
    // ('pull') down... wait, use an unambiguous case: pointer on the target.
    // pointer sits on index 1 ('pull'); moving index 0 ('push') down swaps
    // push and pull, so the pointer (on 'pull') must move to index 0.
    const result = moveSlot(cycle(['push', 'pull', 'legs'], 1), 0, 'down');
    expect(result.routineIds).toEqual(['pull', 'push', 'legs']);
    expect(result.currentIndex).toBe(0);
    expect(nextRoutineId(result)).toBe('pull');
  });

  it('is a no-op moving the first slot up', () => {
    const before = cycle(['push', 'pull', 'legs'], 1);
    const result = moveSlot(before, 0, 'up');
    expect(result).toBe(before);
  });

  it('is a no-op moving the last slot down', () => {
    const before = cycle(['push', 'pull', 'legs'], 1);
    const result = moveSlot(before, 2, 'down');
    expect(result).toBe(before);
  });

  it('does not mutate the input', () => {
    const before = cycle(['push', 'pull', 'legs'], 0);
    moveSlot(before, 0, 'down');
    expect(before.routineIds).toEqual(['push', 'pull', 'legs']);
    expect(before.currentIndex).toBe(0);
  });
});
