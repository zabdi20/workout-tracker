import type { Equipment, MuscleGroup } from '../db/types';

const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  chest: 'Chest',
  delts: 'Shoulders',
  front_delts: 'Front delts',
  side_delts: 'Side delts',
  rear_delts: 'Rear delts',
  lats: 'Lats',
  traps: 'Traps',
  upper_back: 'Upper back',
  lower_back: 'Lower back',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  calves: 'Calves',
  adductors: 'Adductors',
  abductors: 'Abductors',
  abs: 'Abs',
  obliques: 'Obliques',
  neck: 'Neck',
};

const EQUIPMENT_LABELS: Record<Equipment, string> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  machine: 'Machine',
  cable: 'Cable',
  bodyweight: 'Bodyweight',
  kettlebell: 'Kettlebell',
  band: 'Band',
  smith: 'Smith machine',
  ez_bar: 'EZ bar',
  medicine_ball: 'Medicine ball',
  other: 'Other',
};

export const MUSCLE_GROUPS = Object.keys(MUSCLE_LABELS) as MuscleGroup[];
export const EQUIPMENT_TYPES = Object.keys(EQUIPMENT_LABELS) as Equipment[];

export function muscleLabel(m: MuscleGroup): string {
  return MUSCLE_LABELS[m];
}

export function equipmentLabel(e: Equipment): string {
  return EQUIPMENT_LABELS[e];
}
