import type { Equipment, Exercise, MeasurementType, MuscleGroup } from '../db/types';

/** The shape of a record in free-exercise-db's dist/exercises.json. */
export interface SourceExercise {
  id: string;
  name: string;
  equipment: string | null;
  category: string;
  mechanic: string | null;
  force: string | null;
  level: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
}

const EQUIPMENT: Record<string, Equipment> = {
  barbell: 'barbell',
  dumbbell: 'dumbbell',
  kettlebells: 'kettlebell',
  cable: 'cable',
  machine: 'machine',
  'body only': 'bodyweight',
  bands: 'band',
  'e-z curl bar': 'ez_bar',
};

const MUSCLE: Record<string, MuscleGroup> = {
  abdominals: 'abs',
  abductors: 'abductors',
  adductors: 'adductors',
  biceps: 'biceps',
  calves: 'calves',
  chest: 'chest',
  forearms: 'forearms',
  glutes: 'glutes',
  hamstrings: 'hamstrings',
  lats: 'lats',
  'lower back': 'lower_back',
  'middle back': 'upper_back',
  neck: 'neck',
  quadriceps: 'quads',
  // Source has a single coarse bucket. We record that truth rather than
  // guessing which deltoid head an exercise emphasises.
  shoulders: 'delts',
  traps: 'traps',
  triceps: 'triceps',
};

/** Exercises whose measurement type the general rules get wrong. */
const MEASUREMENT_OVERRIDES: Array<[RegExp, MeasurementType]> = [
  [/\bassisted\b/i, 'assisted_reps'],
  [/\b(plank|hold|iron cross|l-sit)\b|\bdead hang\b/i, 'duration'],
  [/\bfarmer'?s walk\b/i, 'weight_duration'],
];

const KEPT_CATEGORIES = new Set(['strength', 'powerlifting', 'olympic weightlifting']);

export function mapEquipment(source: string | null): Equipment {
  if (!source) return 'other';
  return EQUIPMENT[source] ?? 'other';
}

export function mapMuscle(source: string): MuscleGroup | null {
  return MUSCLE[source] ?? null;
}

function mapMuscles(sources: string[]): MuscleGroup[] {
  const mapped = sources.map(mapMuscle).filter((m): m is MuscleGroup => m !== null);
  return [...new Set(mapped)];
}

export function inferMeasurementType(source: SourceExercise): MeasurementType {
  for (const [pattern, type] of MEASUREMENT_OVERRIDES) {
    if (pattern.test(source.name)) return type;
  }
  if (source.category === 'cardio') return 'distance_duration';
  if (source.category === 'stretching') return 'duration';
  if (mapEquipment(source.equipment) === 'bodyweight') return 'bodyweight_reps';
  return 'weight_reps';
}

export function shouldInclude(source: SourceExercise): boolean {
  if (!KEPT_CATEGORIES.has(source.category)) return false;
  if (mapEquipment(source.equipment) === 'other') return false;
  return mapMuscles(source.primaryMuscles).length > 0;
}

export function toExercise(source: SourceExercise): Exercise {
  const instructions = source.instructions.join(' ').trim();
  return {
    id: source.id,
    name: source.name,
    primaryMuscles: mapMuscles(source.primaryMuscles),
    secondaryMuscles: mapMuscles(source.secondaryMuscles),
    equipment: mapEquipment(source.equipment),
    measurementType: inferMeasurementType(source),
    ...(instructions ? { instructions } : {}),
    isCustom: false,
    isArchived: false,
  };
}

export function buildLibrary(sources: SourceExercise[]): Exercise[] {
  const byName = new Map<string, Exercise>();
  for (const source of sources) {
    if (!shouldInclude(source)) continue;
    const key = source.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, toExercise(source));
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
