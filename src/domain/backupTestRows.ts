/**
 * TEST-ONLY. Nothing in app code may import this file.
 *
 * Builds backup tables as plain rows, with no database involved, so the
 * format, the validator and the merge can be tested without Dexie. It imports
 * types from src/db and nothing else from it. `fullTables()` is a small,
 * valid, referentially intact backup in which every optional field is set to
 * a non-default value, at non-round milliseconds: a validator that rejects a
 * legal optional field, or an exporter that drops one, shows up as a failure.
 * Each call returns fresh objects, so a test may mutate what it gets.
 */
import { buildBackup } from './backupFormat';
import type { BackupFile, BackupTables } from './backupFormat';
import type { Cycle, Exercise, LoggedSet, Routine, Session, Settings } from '../db/types';

/** A Monday afternoon in January 2025, comfortably in the past. */
export const T0 = Date.UTC(2025, 0, 6, 17, 0);
export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
/** "Now" for backup tests: thirty days after T0. */
export const NOW = T0 + 30 * DAY;

export function emptyTables(): BackupTables {
  return {
    exercises: [], routines: [], cycles: [], sessions: [],
    sets: [], bodyweight: [], goals: [], settings: [],
  };
}

export function exerciseRow(row: Partial<Exercise> & { id: string }): Exercise {
  return {
    name: row.id,
    primaryMuscles: ['chest'],
    secondaryMuscles: [],
    equipment: 'barbell',
    measurementType: 'weight_reps',
    isCustom: true,
    isArchived: false,
    ...row,
  };
}

export function routineRow(row: Partial<Routine> & { id: string }): Routine {
  return {
    name: row.id,
    items: [],
    isArchived: false,
    createdAt: T0,
    updatedAt: T0,
    ...row,
  };
}

export function cycleRow(row: Partial<Cycle> & { id: string }): Cycle {
  return {
    name: row.id,
    routineIds: [],
    currentIndex: 0,
    isActive: false,
    ...row,
  };
}

export function sessionRow(row: Partial<Session> & { id: string }): Session {
  return {
    routineId: null,
    name: row.id,
    startedAt: T0,
    endedAt: T0 + HOUR,
    status: 'completed',
    ...row,
  };
}

export function setRow(row: Partial<LoggedSet> & { id: string; sessionId: string; exerciseId: string }): LoggedSet {
  return {
    order: 0,
    setType: 'working',
    unit: 'lb',
    weight: 100,
    reps: 5,
    completedAt: T0 + MIN,
    ...row,
  };
}

export function settingsRow(row: Partial<Settings> = {}): Settings {
  return {
    id: 'singleton',
    unitPreference: 'lb',
    defaultRestSeconds: 90,
    restAlertSound: true,
    libraryVersion: 2,
    ...row,
  };
}

export function fullTables(): BackupTables {
  return {
    exercises: [exerciseRow({
      id: 'ex-custom',
      name: 'Explosive Box Step-Up',
      measurementType: 'bodyweight_reps',
      primaryMuscles: ['quads'],
      secondaryMuscles: ['glutes'],
      equipment: 'other',
      instructions: 'Step up fast',
      defaultIncrement: 2.5,
      isCustom: true,
    })],
    routines: [routineRow({
      id: 'r-upper',
      name: 'Upper A',
      notes: 'Heavy',
      items: [{
        id: 'i1', exerciseId: 'ex-custom', order: 0, supersetGroup: null,
        restSeconds: 90, targetSets: 3, targetRepMin: 6, targetRepMax: 8,
      }],
      createdAt: T0 + 11,
      updatedAt: T0 + MIN + 13,
    })],
    cycles: [cycleRow({ id: 'c-main', routineIds: ['r-upper'], currentIndex: 0, isActive: true })],
    sessions: [sessionRow({
      id: 'w-1',
      routineId: 'r-upper',
      name: 'Upper A',
      startedAt: T0 + 123,
      endedAt: T0 + HOUR + 456,
      notes: 'Good day',
      bodyweightAtTime: 80.5,
    })],
    sets: [setRow({
      id: 's-1',
      sessionId: 'w-1',
      exerciseId: 'ex-custom',
      order: 0,
      weight: 22.5,
      unit: 'lb',
      reps: 8,
      durationSeconds: 30,
      distanceMeters: 12.5,
      rpe: 8.5,
      completedAt: T0 + MIN + 789,
      notes: 'Felt good',
    })],
    bodyweight: [{ id: 'bw-1', date: T0 + 7, weight: 80.5, unit: 'kg' }],
    goals: [{
      id: 'g-1',
      type: 'lift_weight_reps',
      exerciseId: 'ex-custom',
      targetValue: 100,
      targetReps: 5,
      unit: 'kg',
      targetDate: T0 + 400 * DAY, // after NOW on purpose
      createdAt: T0 + 3,
      achievedAt: T0 + DAY + 5,
    }],
    settings: [settingsRow({
      unitPreference: 'kg',
      defaultRestSeconds: 120,
      lastBackupAt: T0 + 17,
      restAlertSound: false,
    })],
  };
}

export function backupFile(tables: BackupTables, exportedAt = NOW - DAY): BackupFile {
  return buildBackup(tables, { exportedAt, dbVersion: 1, libraryVersion: 2 });
}
