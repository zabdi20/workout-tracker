import { addItem, removeItem, moveItem } from './routineItems';
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
