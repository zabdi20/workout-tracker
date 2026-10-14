import type { LoggedSet, MeasurementType } from '../db/types';

export type SetFieldName = 'weight' | 'assistance' | 'reps' | 'duration' | 'distance';

export interface SetFieldSpec {
  name: SetFieldName;
  /** The LoggedSet property this field reads and writes. */
  property: 'weight' | 'reps' | 'durationSeconds' | 'distanceMeters';
  label: string;
  /** True when the value carries the set's WeightUnit alongside it. */
  unitBearing: boolean;
}

const WEIGHT: SetFieldSpec = {
  name: 'weight', property: 'weight', label: 'Weight', unitBearing: true,
};

// Shares LoggedSet.weight with WEIGHT but means the opposite: the
// counterweight the machine takes off, not the load lifted. Stored as a
// positive number so no consumer has to know about a sign convention, and
// labelled here so the UI cannot render it as load.
const ASSISTANCE: SetFieldSpec = {
  name: 'assistance', property: 'weight', label: 'Assistance', unitBearing: true,
};

const REPS: SetFieldSpec = {
  name: 'reps', property: 'reps', label: 'Reps', unitBearing: false,
};

const DURATION: SetFieldSpec = {
  name: 'duration', property: 'durationSeconds', label: 'Seconds', unitBearing: false,
};

// Not unit-bearing: distance is canonical metres, unlike weight, because it
// has no plate-math or exact-recall requirement.
const DISTANCE: SetFieldSpec = {
  name: 'distance', property: 'distanceMeters', label: 'Metres', unitBearing: false,
};

/**
 * Which inputs a measurement type needs, in the order they are shown.
 *
 * This table is what lets planks, dips, assisted pull-ups and treadmill work
 * share one schema. Without measurementType they would each need their own.
 */
const FIELDS: Record<MeasurementType, SetFieldSpec[]> = {
  weight_reps: [WEIGHT, REPS],
  bodyweight_reps: [REPS],
  assisted_reps: [ASSISTANCE, REPS],
  duration: [DURATION],
  distance_duration: [DISTANCE, DURATION],
  weight_duration: [WEIGHT, DURATION],
};

export function measurementFields(type: MeasurementType): SetFieldSpec[] {
  return FIELDS[type];
}

/**
 * Turns the strings in a set's input fields into the values to store.
 *
 * The one place that decides what a valid set is, shared by the active
 * workout's confirm and History's edit and add forms so the two can never
 * disagree. A blank field, or one that does not parse to a number, is
 * omitted rather than stored as `undefined` or `NaN`. Zero is a real value
 * and is kept. Nothing else is validated, on purpose.
 *
 * `raw` is asked for each field's property, so the caller decides where the
 * strings live: drafts layered over a prefill, or a form's own state.
 */
export function parseSetFields(
  fields: SetFieldSpec[],
  raw: (property: SetFieldSpec['property']) => string,
): Partial<Pick<LoggedSet, SetFieldSpec['property']>> {
  const values: Partial<Pick<LoggedSet, SetFieldSpec['property']>> = {};
  for (const field of fields) {
    const text = raw(field.property);
    const parsed = text.trim() === '' ? undefined : Number(text);
    // Cast deliberately: field.property is a union of four keys, and
    // TypeScript narrows a union-keyed write to their intersection, which
    // is `never`. The runtime shape is correct by construction.
    if (parsed !== undefined && !Number.isNaN(parsed)) {
      (values as Record<string, number>)[field.property] = parsed;
    }
  }
  return values;
}

/**
 * m:ss. Minutes run past sixty rather than growing an hours field — a gym
 * set is never hours long, and a bare m:ss stays unambiguous.
 */
export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * One set as a line of reference text, e.g. "135 lb x 8".
 *
 * Returns an em dash when the values a type needs are absent, so a
 * half-written set can never render the string "undefined".
 */
export function formatSet(set: LoggedSet, type: MeasurementType): string {
  const { weight, reps, durationSeconds: secs, distanceMeters: metres, unit } = set;
  const missing = '—';

  switch (type) {
    case 'weight_reps':
      if (weight === undefined || reps === undefined) return missing;
      return `${weight} ${unit} × ${reps}`;
    case 'bodyweight_reps':
      if (reps === undefined) return missing;
      return `${reps} reps`;
    case 'assisted_reps':
      if (weight === undefined || reps === undefined) return missing;
      return `${reps} reps, ${weight} ${unit} assist`;
    case 'duration':
      if (secs === undefined) return missing;
      return formatDuration(secs);
    case 'distance_duration':
      if (metres === undefined || secs === undefined) return missing;
      return `${metres} m in ${formatDuration(secs)}`;
    case 'weight_duration':
      if (weight === undefined || secs === undefined) return missing;
      return `${weight} ${unit} for ${formatDuration(secs)}`;
  }
}
