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
