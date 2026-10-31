/**
 * Checks backup rows against this build's types before anything is written,
 * and again, as a self-check, before a backup is saved.
 *
 * Pure: no I/O, and only types from src/db. A file is refused whole, so both
 * functions return the FIRST problem as a sentence the user can read, or
 * null. "First" is deterministic: tables in the file's table order; within a
 * table, rows in array order and then the table-level checks; within a row,
 * fields in the order src/db/types.ts declares them.
 *
 * Unknown extra fields on a row are ignored. Optional fields may be absent or
 * undefined but never null; Session.routineId and RoutineItem.supersetGroup
 * are the two that may be null.
 */
import type {
  BodyweightEntry, Cycle, Exercise, Goal, GoalType, LoggedSet, MeasurementType, Routine,
  RoutineItem, Session, SessionStatus, SetType, Settings, WeightUnit,
} from '../db/types';
import type { BackupTables } from './backupFormat';
import { EQUIPMENT_TYPES, MUSCLE_GROUPS } from './labels';

const DAY = 86_400_000;

export const EARLIEST_PLAUSIBLE_TIME = Date.UTC(2000, 0, 1);
/** Must equal SETTINGS_ID in src/db/db.ts. The domain can't import it, so a
 *  test over there pins the two together. */
export const SETTINGS_ROW_ID = 'singleton';

// Declared as Records so that adding a member to a union fails tsc until it is
// added here.
const MEASUREMENT_TYPES: Record<MeasurementType, true> = {
  weight_reps: true, bodyweight_reps: true, assisted_reps: true,
  duration: true, distance_duration: true, weight_duration: true,
};
const WEIGHT_UNITS: Record<WeightUnit, true> = { kg: true, lb: true };
const SET_TYPES: Record<SetType, true> = { working: true, warmup: true };
const SESSION_STATUSES: Record<SessionStatus, true> = { in_progress: true, completed: true };
const GOAL_TYPES: Record<GoalType, true> = {
  lift_1rm: true, lift_weight_reps: true, bodyweight: true, frequency: true,
};

type Row = Record<string, unknown>;

const asRow = (v: unknown): Row =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Row) : {};

// ---- Field kinds -----------------------------------------------------------

/** What is wrong with a value: the ending of the sentence, and, for a problem
 *  inside a list of objects, where in the field it is. */
interface Found { text: string; at?: string }
type Kind = (value: unknown) => Found | null;

const fail = (text: string): Found => ({ text });

const text: Kind = (v) => (typeof v === 'string' ? null : fail('is not text.'));
const flag: Kind = (v) => (typeof v === 'boolean' ? null : fail('is not true or false.'));
const finite: Kind = (v) =>
  typeof v === 'number' && Number.isFinite(v) ? null : fail('is not a finite number.');

const oneOf = (allowed: readonly string[]): Kind => (v) =>
  typeof v === 'string' && allowed.includes(v) ? null : fail('is not a known value.');

const listOf = (item: Kind): Kind => (v) => {
  if (!Array.isArray(v)) return fail('is not a list.');
  for (const element of v) {
    const found = item(element);
    if (found) return found;
  }
  return null;
};

/** A plausible date: not before 2000 and, unless `open`, not more than a day
 *  after `now`. */
const time = (now: number, open = false): Kind => (v) => {
  const notFinite = finite(v);
  if (notFinite) return notFinite;
  if ((v as number) < EARLIEST_PLAUSIBLE_TIME) return fail('is before 2000.');
  if (!open && (v as number) > now + DAY) return fail('is in the future.');
  return null;
};

export const isPlausibleTime = (v: unknown, now: number): boolean => time(now)(v) === null;

// ---- Field specs, one per row type, in declaration order -------------------

interface Spec { kind: Kind; optional?: boolean; nullable?: boolean }
type Fields<T> = { [K in keyof T]-?: Spec };

const req = (kind: Kind): Spec => ({ kind });
const opt = (kind: Kind): Spec => ({ kind, optional: true });
const orNull = (spec: Spec): Spec => ({ ...spec, nullable: true });

/** The first problem in a row, as the field and what is wrong with it. `afterId`
 *  runs once the id is known to be text, so id problems come in the id's place. */
function firstIssue(
  fields: Record<string, Spec>,
  row: Row,
  afterId?: (id: string) => string | null,
): { field: string; text: string } | null {
  for (const [name, spec] of Object.entries(fields)) {
    const value = row[name];
    if (value === undefined) {
      if (spec.optional) continue;
      return { field: name, text: 'is missing.' };
    }
    if (value === null && spec.nullable) continue;
    const found = spec.kind(value);
    if (found) return { field: name + (found.at ?? ''), text: found.text };
    if (name === 'id' && afterId) {
      const problem = afterId(value as string);
      if (problem) return { field: name, text: problem };
    }
  }
  return null;
}

function schemas(now: number) {
  const past = time(now);
  const anyTime = time(now, true);

  const routineItem: Fields<RoutineItem> = {
    id: req(text),
    exerciseId: req(text),
    order: req(finite),
    supersetGroup: orNull(opt(text)),
    restSeconds: opt(finite),
    targetSets: opt(finite),
    targetRepMin: opt(finite),
    targetRepMax: opt(finite),
  };

  const items: Kind = (v) => {
    if (!Array.isArray(v)) return fail('is not a list.');
    for (let i = 0; i < v.length; i++) {
      const issue = firstIssue(routineItem, asRow(v[i]));
      if (issue) return { text: issue.text, at: `[${i}].${issue.field}` };
    }
    return null;
  };

  const exercise: Fields<Exercise> = {
    id: req(text),
    name: req(text),
    primaryMuscles: req(listOf(oneOf(MUSCLE_GROUPS))),
    secondaryMuscles: req(listOf(oneOf(MUSCLE_GROUPS))),
    equipment: req(oneOf(EQUIPMENT_TYPES)),
    measurementType: req(oneOf(Object.keys(MEASUREMENT_TYPES))),
    instructions: opt(text),
    isCustom: req(flag),
    isArchived: req(flag),
    defaultIncrement: opt(finite),
  };

  const routine: Fields<Routine> = {
    id: req(text),
    name: req(text),
    notes: opt(text),
    items: req(items),
    isArchived: req(flag),
    createdAt: req(past),
    updatedAt: req(past),
  };

  const cycle: Fields<Cycle> = {
    id: req(text),
    name: req(text),
    routineIds: req(listOf(text)),
    currentIndex: req(finite),
    isActive: req(flag),
  };

  const session: Fields<Session> = {
    id: req(text),
    routineId: orNull(req(text)),
    name: req(text),
    startedAt: req(past),
    endedAt: opt(past),
    status: req(oneOf(Object.keys(SESSION_STATUSES))),
    notes: opt(text),
    bodyweightAtTime: opt(finite),
  };

  const set: Fields<LoggedSet> = {
    id: req(text),
    sessionId: req(text),
    exerciseId: req(text),
    order: req(finite),
    setType: req(oneOf(Object.keys(SET_TYPES))),
    weight: opt(finite),
    unit: req(oneOf(Object.keys(WEIGHT_UNITS))),
    reps: opt(finite),
    durationSeconds: opt(finite),
    distanceMeters: opt(finite),
    rpe: opt(finite),
    completedAt: req(past),
    notes: opt(text),
  };

  const bodyweight: Fields<BodyweightEntry> = {
    id: req(text),
    date: req(past),
    weight: req(finite),
    unit: req(oneOf(Object.keys(WEIGHT_UNITS))),
  };

  const goal: Fields<Goal> = {
    id: req(text),
    type: req(oneOf(Object.keys(GOAL_TYPES))),
    exerciseId: opt(text),
    targetValue: req(finite),
    targetReps: opt(finite),
    unit: opt(oneOf(Object.keys(WEIGHT_UNITS))),
    targetDate: opt(anyTime), // a target belongs in the future
    createdAt: req(past),
    achievedAt: opt(past),
  };

  const settings: Fields<Settings> = {
    id: req(text),
    unitPreference: req(oneOf(Object.keys(WEIGHT_UNITS))),
    defaultRestSeconds: req(finite),
    lastBackupAt: opt(past),
    restAlertSound: req(flag),
    libraryVersion: opt(finite),
  };

  return { exercise, routine, cycle, session, set, bodyweight, goal, settings };
}

// ---- Naming a row in a message ---------------------------------------------

interface Named { id?: unknown; name?: unknown }

/** `"Push A"`, or `(id)` when the name isn't text. */
const quoted = (row: Named): string =>
  typeof row.name === 'string' ? `"${row.name}"` : `(${String(row.id)})`;

/** `"Push A" on 1/6/2025`; the date is left out when startedAt isn't a number. */
const workoutName = (session: Named & { startedAt?: unknown }): string => {
  const at = session.startedAt;
  const on = typeof at === 'number' && Number.isFinite(at)
    ? ` on ${new Date(at).toLocaleDateString()}`
    : '';
  return `${quoted(session)}${on}`;
};

const sessionsById = (tables: BackupTables): Map<unknown, Row> => {
  const byId = new Map<unknown, Row>();
  for (const raw of tables.sessions) {
    const row = asRow(raw);
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  return byId;
};

const setSubject = (set: Row, sessions: Map<unknown, Row>): string => {
  const session = sessions.get(set.sessionId);
  return session ? `A set in workout ${workoutName(session)}` : `A set (${String(set.id)})`;
};

// ---- Validation ------------------------------------------------------------

/** Checks every row of one table. A row's id must be unique, and `idRule` may
 *  add a rule of its own about the id. */
function checkRows(
  rows: unknown[],
  fields: Record<string, Spec>,
  subjectOf: (row: Row) => string,
  idRule?: (id: string) => string | null,
): string | null {
  const seen = new Set<string>();
  for (const raw of rows) {
    const row = asRow(raw);
    const issue = firstIssue(fields, row, (id) => {
      const own = idRule?.(id);
      if (own) return own;
      if (seen.has(id)) return 'is used twice.';
      seen.add(id);
      return null;
    });
    if (issue) return `${subjectOf(row)}: "${issue.field}" ${issue.text}`;
  }
  return null;
}

/** The first problem with the rows themselves, or null. Does not check that
 *  rows point at rows that exist: see checkReferences. */
export function validateTables(tables: BackupTables, now: number): string | null {
  const s = schemas(now);
  const sessions = sessionsById(tables);
  const count = (rows: unknown[], test: (row: Row) => boolean) => rows.filter((r) => test(asRow(r))).length;

  return (
    checkRows(tables.exercises, s.exercise, (r) => `Exercise ${quoted(r)}`) ??
    checkRows(tables.routines, s.routine, (r) => `Routine ${quoted(r)}`) ??
    checkRows(tables.cycles, s.cycle, (r) => `Rotation ${quoted(r)}`) ??
    (count(tables.cycles, (r) => r.isActive === true) > 1 ? 'More than one rotation is active.' : null) ??
    checkRows(tables.sessions, s.session, (r) => `Workout ${workoutName(r)}`) ??
    (count(tables.sessions, (r) => r.status === 'in_progress') > 1
      ? 'More than one workout is in progress.'
      : null) ??
    checkRows(tables.sets, s.set, (r) => setSubject(r, sessions)) ??
    checkRows(tables.bodyweight, s.bodyweight, (r) => `Bodyweight entry ${String(r.id)}`) ??
    checkRows(tables.goals, s.goal, (r) => `Goal ${String(r.id)}`) ??
    checkRows(
      tables.settings, s.settings, () => 'Settings',
      (id) => (id === SETTINGS_ROW_ID ? null : `is not "${SETTINGS_ROW_ID}".`),
    ) ??
    (tables.settings.length !== 1 ? 'There must be exactly one settings row.' : null)
  );
}

/**
 * The first row that points at a row that isn't there, or null. Run it over
 * the MERGED result, not the file alone: a valid backup's sets may point at
 * something already on the phone. Call it only after validateTables passes.
 */
export function checkReferences(tables: BackupTables): string | null {
  const exerciseIds = new Set(tables.exercises.map((e) => e.id));
  const routineIds = new Set(tables.routines.map((r) => r.id));
  const sessions = sessionsById(tables);

  for (const routine of tables.routines) {
    for (const item of routine.items) {
      if (!exerciseIds.has(item.exerciseId)) {
        return `Routine ${quoted(routine)} refers to an exercise that isn't there.`;
      }
    }
  }
  for (const cycle of tables.cycles) {
    for (const routineId of cycle.routineIds) {
      if (!routineIds.has(routineId)) {
        return `Rotation ${quoted(cycle)} refers to a routine that isn't there.`;
      }
    }
  }
  for (const set of tables.sets) {
    const subject = setSubject(asRow(set), sessions);
    if (!sessions.has(set.sessionId)) return `${subject} refers to a workout that isn't there.`;
    if (!exerciseIds.has(set.exerciseId)) return `${subject} refers to an exercise that isn't there.`;
  }
  for (const goal of tables.goals) {
    if (goal.exerciseId !== undefined && !exerciseIds.has(goal.exerciseId)) {
      return `Goal ${goal.id} refers to an exercise that isn't there.`;
    }
  }
  return null;
}
