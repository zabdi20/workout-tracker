import type { Equipment, Exercise, MuscleGroup } from '../db/types';
import { EQUIPMENT_TYPES, MUSCLE_GROUPS } from './labels';

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

/**
 * Muscles actually used (as primary or secondary) by at least one of the
 * given exercises, in the canonical MUSCLE_GROUPS order. Facets are derived
 * from the data rather than the full type vocabulary so the filter sheet
 * never offers an option that can only ever produce zero matches -- and
 * stays correct as custom exercises add muscles the bundled library lacks.
 */
export function availableMuscles(exercises: Exercise[]): MuscleGroup[] {
  const present = new Set<MuscleGroup>();
  for (const e of exercises) {
    for (const m of e.primaryMuscles) present.add(m);
    for (const m of e.secondaryMuscles) present.add(m);
  }
  return MUSCLE_GROUPS.filter((m) => present.has(m));
}

/**
 * Equipment actually used by at least one of the given exercises, in the
 * canonical EQUIPMENT_TYPES order. See availableMuscles for why.
 */
export function availableEquipment(exercises: Exercise[]): Equipment[] {
  const present = new Set(exercises.map((e) => e.equipment));
  return EQUIPMENT_TYPES.filter((eq) => present.has(eq));
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
