export type MuscleGroup =
  | 'chest'
  | 'delts' | 'front_delts' | 'side_delts' | 'rear_delts'
  | 'lats' | 'traps' | 'upper_back' | 'lower_back'
  | 'biceps' | 'triceps' | 'forearms'
  | 'quads' | 'hamstrings' | 'glutes' | 'calves'
  | 'adductors' | 'abductors'
  | 'abs' | 'obliques' | 'neck';

export type Equipment =
  | 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight'
  | 'kettlebell' | 'band' | 'smith' | 'ez_bar' | 'other';

export type MeasurementType =
  | 'weight_reps'
  | 'bodyweight_reps'
  | 'assisted_reps'
  | 'duration'
  | 'distance_duration'
  | 'weight_duration';

export type WeightUnit = 'kg' | 'lb';
export type SetType = 'working' | 'warmup';
export type SessionStatus = 'in_progress' | 'completed';
export type GoalType = 'lift_1rm' | 'lift_weight_reps' | 'bodyweight' | 'frequency';

export interface Exercise {
  id: string;
  name: string;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
  equipment: Equipment;
  measurementType: MeasurementType;
  instructions?: string;
  isCustom: boolean;
  isArchived: boolean;
  /** Smallest sensible weight jump, in the exercise's usual unit. Used by
   *  plate maths and progression suggestions in later plans. */
  defaultIncrement?: number;
}

export interface RoutineItem {
  id: string;
  exerciseId: string;
  order: number;
  /** Items sharing a group are performed alternating. Unused until Plan 3+. */
  supersetGroup?: string | null;
  restSeconds?: number;
  /** Forward-compatibility hooks for suggested progression. No v1 UI. */
  targetSets?: number;
  targetRepMin?: number;
  targetRepMax?: number;
}

export interface Routine {
  id: string;
  name: string;
  notes?: string;
  items: RoutineItem[];
  isArchived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Cycle {
  id: string;
  name: string;
  routineIds: string[];
  currentIndex: number;
  isActive: boolean;
}

export interface Session {
  id: string;
  /** null means a freestyle session not derived from a routine. */
  routineId: string | null;
  /** Snapshotted from the routine so renaming it later does not rewrite history. */
  name: string;
  startedAt: number;
  endedAt?: number;
  status: SessionStatus;
  notes?: string;
  bodyweightAtTime?: number;
}

export interface LoggedSet {
  id: string;
  sessionId: string;
  exerciseId: string;
  order: number;
  setType: SetType;
  /** Stored with the unit it was entered in. NEVER converted on write. */
  weight?: number;
  unit: WeightUnit;
  reps?: number;
  durationSeconds?: number;
  /** Canonical metres, unlike weight. Distance has no exact-recall requirement. */
  distanceMeters?: number;
  /** Forward-compatibility hook for autoregulation. No v1 UI. */
  rpe?: number;
  completedAt: number;
  notes?: string;
}

export interface BodyweightEntry {
  id: string;
  date: number;
  weight: number;
  unit: WeightUnit;
}

export interface Goal {
  id: string;
  type: GoalType;
  exerciseId?: string;
  targetValue: number;
  targetReps?: number;
  unit?: WeightUnit;
  targetDate?: number;
  createdAt: number;
  achievedAt?: number;
}

export interface Settings {
  id: string;
  unitPreference: WeightUnit;
  defaultRestSeconds: number;
  lastBackupAt?: number;
  restAlertSound: boolean;
  /** Which bundled-library revision was seeded onto this device. Lets a
   *  future upgrade path reconcile corrected bundled data on devices that
   *  seeded an earlier revision, without needing a schema migration. Unset
   *  on devices seeded before this field existed. */
  libraryVersion?: number;
}
