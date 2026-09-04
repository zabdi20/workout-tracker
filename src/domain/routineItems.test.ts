import {
  addItem, removeItem, moveItem, setItemPrescription, validatePrescription,
} from './routineItems';
import type { RoutineItem } from '../db/types';

function items(...exerciseIds: string[]): RoutineItem[] {
  return exerciseIds.map((exerciseId, i) => ({
    id: `item-${i}`,
    exerciseId,
    order: i,
  }));
}

describe('addItem', () => {
  it('appends with the next order', () => {
    const result = addItem(items('bench', 'fly'), 'dip', 'new-id');
    expect(result.map((i) => i.exerciseId)).toEqual(['bench', 'fly', 'dip']);
    expect(result.map((i) => i.order)).toEqual([0, 1, 2]);
    expect(result[2].id).toBe('new-id');
  });

  it('appends to an empty list', () => {
    const result = addItem([], 'bench', 'new-id');
    expect(result).toEqual([{ id: 'new-id', exerciseId: 'bench', order: 0 }]);
  });

  it('allows the same exercise twice', () => {
    const result = addItem(items('bench'), 'bench', 'new-id');
    expect(result.map((i) => i.exerciseId)).toEqual(['bench', 'bench']);
  });

  it('does not mutate the input', () => {
    const original = items('bench');
    addItem(original, 'fly', 'new-id');
    expect(original).toHaveLength(1);
  });
});

describe('removeItem', () => {
  it('removes and renumbers', () => {
    const result = removeItem(items('bench', 'fly', 'dip'), 'item-1');
    expect(result.map((i) => i.exerciseId)).toEqual(['bench', 'dip']);
    expect(result.map((i) => i.order)).toEqual([0, 1]);
  });

  it('is a no-op for an unknown id', () => {
    const result = removeItem(items('bench', 'fly'), 'nope');
    expect(result.map((i) => i.exerciseId)).toEqual(['bench', 'fly']);
  });

  it('does not mutate the input', () => {
    const original = items('bench', 'fly');
    removeItem(original, 'item-0');
    expect(original).toHaveLength(2);
  });
});

describe('moveItem', () => {
  it('moves an item up', () => {
    const result = moveItem(items('bench', 'fly', 'dip'), 'item-1', 'up');
    expect(result.map((i) => i.exerciseId)).toEqual(['fly', 'bench', 'dip']);
    expect(result.map((i) => i.order)).toEqual([0, 1, 2]);
  });

  it('moves an item down', () => {
    const result = moveItem(items('bench', 'fly', 'dip'), 'item-1', 'down');
    expect(result.map((i) => i.exerciseId)).toEqual(['bench', 'dip', 'fly']);
  });

  it('leaves the first item alone when moved up', () => {
    const result = moveItem(items('bench', 'fly'), 'item-0', 'up');
    expect(result.map((i) => i.exerciseId)).toEqual(['bench', 'fly']);
  });

  it('leaves the last item alone when moved down', () => {
    const result = moveItem(items('bench', 'fly'), 'item-1', 'down');
    expect(result.map((i) => i.exerciseId)).toEqual(['bench', 'fly']);
  });

  it('is a no-op for an unknown id', () => {
    const result = moveItem(items('bench', 'fly'), 'nope', 'up');
    expect(result.map((i) => i.exerciseId)).toEqual(['bench', 'fly']);
  });

  it('preserves other item fields', () => {
    const withRest: RoutineItem[] = [
      { id: 'a', exerciseId: 'bench', order: 0, restSeconds: 90 },
      { id: 'b', exerciseId: 'fly', order: 1 },
    ];
    const result = moveItem(withRest, 'b', 'up');
    expect(result[1]).toEqual({ id: 'a', exerciseId: 'bench', order: 1, restSeconds: 90 });
  });

  it('does not mutate the input', () => {
    const original = items('bench', 'fly');
    moveItem(original, 'item-0', 'down');
    expect(original.map((i) => i.exerciseId)).toEqual(['bench', 'fly']);
  });
});

describe('setItemPrescription', () => {
  const items = [
    { id: 'a', exerciseId: 'bench', order: 0 },
    { id: 'b', exerciseId: 'row', order: 1 },
  ];

  it('applies the patch to the named item only', () => {
    const next = setItemPrescription(items, 'a', { targetSets: 4 });
    expect(next[0].targetSets).toBe(4);
    expect(next[1].targetSets).toBeUndefined();
  });

  it('merges into an existing prescription', () => {
    const withSets = setItemPrescription(items, 'a', { targetSets: 4 });
    const next = setItemPrescription(withSets, 'a', { targetRepMin: 6 });
    expect(next[0].targetSets).toBe(4);
    expect(next[0].targetRepMin).toBe(6);
  });

  it('deletes the key when a field is cleared, rather than storing undefined', () => {
    const withSets = setItemPrescription(items, 'a', { targetSets: 4 });
    const next = setItemPrescription(withSets, 'a', { targetSets: undefined });
    expect('targetSets' in next[0]).toBe(false);
  });

  it('leaves order and exerciseId untouched', () => {
    const next = setItemPrescription(items, 'b', { restSeconds: 120 });
    expect(next[1].order).toBe(1);
    expect(next[1].exerciseId).toBe('row');
  });

  it('returns the list unchanged for an unknown item', () => {
    expect(setItemPrescription(items, 'missing', { targetSets: 4 })).toEqual(items);
  });
});

describe('validatePrescription', () => {
  it('accepts an empty patch', () => {
    expect(validatePrescription({})).toBeNull();
  });

  it('accepts a complete, ordered prescription', () => {
    expect(validatePrescription({
      targetSets: 4, targetRepMin: 6, targetRepMax: 8, restSeconds: 120,
    })).toBeNull();
  });

  it('rejects a rep range that runs backwards', () => {
    expect(validatePrescription({ targetRepMin: 8, targetRepMax: 6 }))
      .toMatch(/rep range/i);
  });

  it('accepts a single-value rep range', () => {
    expect(validatePrescription({ targetRepMin: 8, targetRepMax: 8 })).toBeNull();
  });

  it('rejects zero and negative values', () => {
    expect(validatePrescription({ targetSets: 0 })).toMatch(/whole number/i);
    expect(validatePrescription({ restSeconds: -30 })).toMatch(/whole number/i);
  });

  it('rejects fractional values', () => {
    expect(validatePrescription({ targetSets: 2.5 })).toMatch(/whole number/i);
  });

  it('ignores the range check when only one end is set', () => {
    expect(validatePrescription({ targetRepMin: 8 })).toBeNull();
    expect(validatePrescription({ targetRepMax: 6 })).toBeNull();
  });
});
