import type { Equipment, Exercise, MuscleGroup } from '../db/types';

export interface ExerciseFilter {
  query: string;
  muscles: MuscleGroup[];
  equipment: Equipment[];
}

export const EMPTY_FILTER: ExerciseFilter = {
  query: '',
  muscles: [],
  equipment: [],
};

export function isFilterActive(filter: ExerciseFilter): boolean {
  return (
    filter.query.trim().length > 0 ||
    filter.muscles.length > 0 ||
    filter.equipment.length > 0
  );
}

function matchesQuery(exercise: Exercise, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const name = exercise.name.toLowerCase();
  return tokens.every((token) => name.includes(token));
}

function matchesMuscles(exercise: Exercise, muscles: MuscleGroup[]): boolean {
  if (muscles.length === 0) return true;
  const worked = new Set([...exercise.primaryMuscles, ...exercise.secondaryMuscles]);
  return muscles.some((m) => worked.has(m));
}

function matchesEquipment(exercise: Exercise, equipment: Equipment[]): boolean {
  if (equipment.length === 0) return true;
  return equipment.includes(exercise.equipment);
}

export function filterExercises(
  exercises: Exercise[],
  filter: ExerciseFilter,
): Exercise[] {
  return exercises
    .filter(
      (e) =>
        matchesQuery(e, filter.query) &&
        matchesMuscles(e, filter.muscles) &&
        matchesEquipment(e, filter.equipment),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}
