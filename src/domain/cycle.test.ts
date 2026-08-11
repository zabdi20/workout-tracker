import { nextRoutineId, advanceAfter, skipNext, withoutRoutine } from './cycle';
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
    const result = withoutRoutine(cycle(['push', 'push', 'legs'], 2), 'push');
    expect(result.routineIds).toEqual(['legs']);
    expect(nextRoutineId(result)).toBe('legs');
  });

  it('keeps the pointer sensible when the pointed-at routine is removed', () => {
    const result = withoutRoutine(cycle(['push', 'pull', 'legs'], 1), 'pull');
    expect(result.routineIds).toEqual(['push', 'legs']);
    expect(nextRoutineId(result)).toBe('legs');
  });
});
