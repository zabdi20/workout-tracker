import { db } from './db';
import type { Equipment, Exercise, MeasurementType, MuscleGroup } from './types';

export interface NewCustomExercise {
  name: string;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
  equipment: Equipment;
  measurementType: MeasurementType;
  instructions?: string;
  defaultIncrement?: number;
}

export async function listExercises(
  opts: { includeArchived?: boolean } = {},
): Promise<Exercise[]> {
  const all = await db.exercises.toArray();
  const visible = opts.includeArchived ? all : all.filter((e) => !e.isArchived);
  return visible.sort((a, b) => a.name.localeCompare(b.name));
}

export function getExercise(id: string): Promise<Exercise | undefined> {
  return db.exercises.get(id);
}

export async function createCustomExercise(input: NewCustomExercise): Promise<Exercise> {
  const name = input.name.trim();
  if (!name) throw new Error('Exercise name is required');
  if (input.primaryMuscles.length === 0) {
    throw new Error('At least one primary muscle is required');
  }

  const exercise: Exercise = {
    ...input,
    id: crypto.randomUUID(),
    name,
    isCustom: true,
    isArchived: false,
  };
  await db.exercises.add(exercise);
  return exercise;
}

export async function updateExercise(
  id: string,
  changes: Partial<Exercise>,
): Promise<void> {
  await db.exercises.update(id, changes);
}

/**
 * Archives rather than deletes. A hard delete would orphan every LoggedSet
 * that references this exercise.
 */
export async function archiveExercise(id: string): Promise<void> {
  await db.exercises.update(id, { isArchived: true });
}

export async function unarchiveExercise(id: string): Promise<void> {
  await db.exercises.update(id, { isArchived: false });
}
