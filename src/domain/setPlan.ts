import type { LoggedSet, WeightUnit } from '../db/types';

/**
 * A row the user has not confirmed yet.
 *
 * Deliberately not a LoggedSet: nothing reaches the sets table until the
 * user taps confirm, so PR detection, volume, history and the backup format
 * never have to filter out sets that were not performed. A filter bug there
 * would render as a fake PR.
 */
export interface PlannedSet {
  /** 1-based working-set number shown to the user. */
  position: number;
  unit: WeightUnit;
  weight?: number;
  reps?: number;
  durationSeconds?: number;
  distanceMeters?: number;
}

export interface PlanSetsInput {
  /** RoutineItem.targetSets, when the routine prescribes one. */
  targetSets?: number;
  /** This exercise's sets from the previous session, warm-ups included. */
  lastPerformance: LoggedSet[];
  /** This exercise's sets already logged in the current session. */
  logged: LoggedSet[];
  /** Settings.unitPreference, used when there is no history to carry. */
  defaultUnit: WeightUnit;
  /** Signed count of rows the user added or removed this session. */
  adjust?: number;
}

function working(sets: LoggedSet[]): LoggedSet[] {
  return sets
    .filter((s) => s.setType === 'working')
    .sort((a, b) => a.order - b.order);
}

/**
 * Derives the unconfirmed rows for one exercise.
 *
 * Count is the prescription, else last time's working-set count, else one.
 * Row N prefills from last time's working set N, falling back to its final
 * set — which preserves last week's ramp, so 135/135/145 leaves 145 waiting
 * on set 3 rather than repeating 135.
 *
 * Warm-ups are additive at both ends: one logged today does not consume a
 * planned row, and one logged last time does not shift the positions.
 */
export function planSets(input: PlanSetsInput): PlannedSet[] {
  const { targetSets, lastPerformance, logged, defaultUnit, adjust = 0 } = input;

  const lastWorking = working(lastPerformance);
  const doneCount = working(logged).length;

  const prescribed =
    targetSets !== undefined && targetSets > 0 ? targetSets : lastWorking.length || 1;

  // Clamped at doneCount, never below: removing rows must not hide a set
  // that was actually performed.
  const total = Math.max(doneCount, prescribed + adjust);

  const rows: PlannedSet[] = [];
  for (let position = doneCount + 1; position <= total; position += 1) {
    const source = lastWorking[position - 1] ?? lastWorking[lastWorking.length - 1];
    rows.push({
      position,
      unit: source?.unit ?? defaultUnit,
      weight: source?.weight,
      reps: source?.reps,
      durationSeconds: source?.durationSeconds,
      distanceMeters: source?.distanceMeters,
    });
  }
  return rows;
}
