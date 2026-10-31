/**
 * The merge plan: what a restore would write, decided before anything is.
 *
 * Pure: no I/O, and nothing from src/db at runtime. Given the phone's rows,
 * a parsed backup and this build's bundled library, `planMerge` says which
 * rows to put (added or replaced), which empty rotation to delete, and what to
 * tell the user. Applying the plan, in one transaction, is another function's
 * job. The rules are the spec's "The merge rules"; the short version is that
 * the phone's copy wins, with a handful of named exceptions.
 */
import type { Exercise, Settings } from '../db/types';
import type { BackupFile, BackupTables } from './backupFormat';
import { checkReferences } from './backupValidate';

export interface MergeSummary {
  /** Workouts added. */
  workouts: number;
  /** Sets added. */
  sets: number;
  routines: number;
  /** Custom exercises added, i.e. not matched to one already on the phone. */
  customExercises: number;
  /** Untouched library exercises replaced by the backup's edited copy. */
  libraryEdits: number;
  /** The phone's name for each custom exercise the backup's history joined. */
  matchedExercises: string[];
  /** The phone's own rotation was set aside for the backup's. */
  rotationReplaced: boolean;
  /** What the settings switch to. */
  settings: Pick<Settings, 'unitPreference' | 'defaultRestSeconds' | 'restAlertSound'>;
}

export interface MergePlan {
  /** Every row to write, added or replaced, by table. */
  put: BackupTables;
  /** The empty rotation a fresh phone starts with, when the backup's takes over. */
  deleteCycleIds: string[];
  summary: MergeSummary;
}

export type MergeResult =
  | { ok: true; plan: MergePlan }
  | { ok: false; reason: 'in-progress' | 'damaged'; detail: string };

// ---- Comparing rows --------------------------------------------------------

/** The same value with every object's keys in sorted order. JSON.stringify
 *  already leaves out a key whose value is undefined, so an absent key and an
 *  undefined one come out the same. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonical(record[key])]));
  }
  return value;
}

/** Deep equality, ignoring key order, with an absent key equal to an
 *  undefined one. List order matters. */
export function sameRow(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/** Nothing for the confirmation to list: every count is zero, no custom
 *  exercise was matched and no rotation was set aside. */
export function addsNothing(summary: MergeSummary): boolean {
  return (
    summary.workouts === 0 &&
    summary.sets === 0 &&
    summary.routines === 0 &&
    summary.customExercises === 0 &&
    summary.libraryEdits === 0 &&
    summary.matchedExercises.length === 0 &&
    !summary.rotationReplaced
  );
}

// ---- Helpers ---------------------------------------------------------------

const noRows = (): BackupTables => ({
  exercises: [], routines: [], cycles: [], sessions: [],
  sets: [], bodyweight: [], goals: [], settings: [],
});

const byId = <T extends { id: string }>(rows: T[]): Map<string, T> =>
  new Map(rows.map((row) => [row.id, row]));

/** An exercise's name as matching sees it. */
const nameKey = (exercise: Exercise): string => exercise.name.trim().toLowerCase();

/** Unarchived before archived, then the lowest id. Plain code-unit order, so
 *  the choice does not depend on the device's locale. */
const preferred = (a: Exercise, b: Exercise): number =>
  Number(a.isArchived) - Number(b.isArchived) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** `rows` with `put` laid over them by id: replaced in place, new ones last. */
function overlay<T extends { id: string }>(rows: T[], put: T[]): T[] {
  const replacement = byId(put);
  const present = new Set(rows.map((row) => row.id));
  return [...rows.map((row) => replacement.get(row.id) ?? row), ...put.filter((row) => !present.has(row.id))];
}

/** What the phone would hold once the plan was written. */
function applied(phone: BackupTables, put: BackupTables, deleteCycleIds: string[]): BackupTables {
  return {
    exercises: overlay(phone.exercises, put.exercises),
    routines: overlay(phone.routines, put.routines),
    cycles: overlay(phone.cycles, put.cycles).filter((cycle) => !deleteCycleIds.includes(cycle.id)),
    sessions: overlay(phone.sessions, put.sessions),
    sets: overlay(phone.sets, put.sets),
    bodyweight: overlay(phone.bodyweight, put.bodyweight),
    goals: overlay(phone.goals, put.goals),
    settings: overlay(phone.settings, put.settings),
  };
}

/** The one settings row after the merge: three fields from the backup, the
 *  library version and everything else from the phone, and the later of the
 *  two backup dates. */
function mergedSettings(phone: Settings, backup: BackupFile): Settings {
  const file = backup.tables.settings[0];
  return {
    ...phone,
    unitPreference: file.unitPreference,
    defaultRestSeconds: file.defaultRestSeconds,
    restAlertSound: file.restAlertSound,
    lastBackupAt: Math.max(phone.lastBackupAt ?? -Infinity, backup.exportedAt),
  };
}

// ---- The plan --------------------------------------------------------------

/**
 * Precondition: `phone.settings` holds exactly one row, with its defaults
 * already filled in, and the backup passed `validateTables`. Neither input is
 * changed.
 */
export function planMerge(phone: BackupTables, backup: BackupFile, bundled: Exercise[]): MergeResult {
  // 1. Refuse an in-progress phone.
  if (phone.sessions.some((session) => session.status === 'in_progress')) {
    return {
      ok: false,
      reason: 'in-progress',
      detail: 'Finish or discard your workout in progress before restoring.',
    };
  }

  const file = backup.tables;
  const put = noRows();
  const deleteCycleIds: string[] = [];
  const settings = mergedSettings(phone.settings[0], backup);
  const summary: MergeSummary = {
    workouts: 0, sets: 0, routines: 0, customExercises: 0, libraryEdits: 0,
    matchedExercises: [], rotationReplaced: false,
    settings: {
      unitPreference: settings.unitPreference,
      defaultRestSeconds: settings.defaultRestSeconds,
      restAlertSound: settings.restAlertSound,
    },
  };

  // 2. Exercises.
  const phoneExercises = byId(phone.exercises);
  const bundledEntries = byId(bundled);
  const phoneCustoms = phone.exercises.filter((exercise) => exercise.isCustom).sort(preferred);
  /** Backup id -> the phone's id, for each recreated custom exercise. */
  const matched = new Map<string, string>();

  for (const row of file.exercises) {
    const onPhone = phoneExercises.get(row.id);
    if (onPhone) {
      const entry = bundledEntries.get(row.id);
      if (entry && sameRow(onPhone, entry) && !sameRow(onPhone, row)) {
        put.exercises.push(row);
        summary.libraryEdits++;
      }
    } else if (row.isCustom) {
      const match = phoneCustoms.find(
        (custom) => nameKey(custom) === nameKey(row) && custom.measurementType === row.measurementType,
      );
      if (match) {
        matched.set(row.id, match.id);
        summary.matchedExercises.push(match.name);
      } else {
        put.exercises.push(row);
        summary.customExercises++;
      }
    } else {
      put.exercises.push(row); // a newer library's row: never name-matched, not counted
    }
  }

  // 3. The id a backup row should point at. Only rows from the file are rewritten.
  const exerciseIdFor = (id: string): string => matched.get(id) ?? id;

  // 4. Routines, workouts, sets, bodyweight and goals: added when the id is absent.
  const phoneRoutines = byId(phone.routines);
  for (const row of file.routines) {
    if (phoneRoutines.has(row.id)) continue;
    put.routines.push({
      ...row,
      items: row.items.map((item) => ({ ...item, exerciseId: exerciseIdFor(item.exerciseId) })),
    });
    summary.routines++;
  }

  const phoneSessions = byId(phone.sessions);
  for (const row of file.sessions) {
    if (phoneSessions.has(row.id)) continue;
    put.sessions.push(row);
    summary.workouts++;
  }

  const backupSessions = byId(file.sessions);
  const phoneSets = byId(phone.sets);
  for (const row of file.sets) {
    if (phoneSets.has(row.id)) continue;
    // A workout the phone has but moved since the backup: the set moves with it.
    const there = phoneSessions.get(row.sessionId);
    const was = backupSessions.get(row.sessionId);
    const shift = there && was ? there.startedAt - was.startedAt : 0;
    put.sets.push({ ...row, exerciseId: exerciseIdFor(row.exerciseId), completedAt: row.completedAt + shift });
    summary.sets++;
  }

  const phoneBodyweight = byId(phone.bodyweight);
  for (const row of file.bodyweight) {
    if (!phoneBodyweight.has(row.id)) put.bodyweight.push(row);
  }

  const phoneGoals = byId(phone.goals);
  for (const row of file.goals) {
    if (phoneGoals.has(row.id)) continue;
    put.goals.push(row.exerciseId === undefined ? row : { ...row, exerciseId: exerciseIdFor(row.exerciseId) });
  }

  // 5. Cycles.
  const phoneCycles = byId(phone.cycles);
  const backupActive = file.cycles.find((cycle) => cycle.isActive);
  const phoneActive = phone.cycles.find((cycle) => cycle.isActive);

  for (const row of file.cycles) {
    if (!row.isActive && !phoneCycles.has(row.id)) put.cycles.push(row);
  }
  if (backupActive && backupActive.id !== phoneActive?.id) {
    // The phone's copy of this rotation wins if it has one (set aside by an
    // earlier restore): only its flag changes.
    put.cycles.push({ ...(phoneCycles.get(backupActive.id) ?? backupActive), isActive: true });
    if (phoneActive) {
      if (phoneActive.routineIds.length === 0) {
        deleteCycleIds.push(phoneActive.id);
      } else {
        put.cycles.push({ ...phoneActive, isActive: false });
        summary.rotationReplaced = true;
      }
    }
  }

  // 6. Settings: one row, put only if it differs from the phone's.
  if (!sameRow(settings, phone.settings[0])) put.settings.push(settings);

  // 7. References, over the merged result and not the file alone.
  const problem = checkReferences(applied(phone, put, deleteCycleIds));
  if (problem !== null) return { ok: false, reason: 'damaged', detail: problem };

  return { ok: true, plan: { put, deleteCycleIds, summary } };
}
