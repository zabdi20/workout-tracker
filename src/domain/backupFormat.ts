/**
 * The backup file: its envelope, its name, and reading one back.
 *
 * Pure: no I/O, and nothing from src/db at runtime. `parseBackup` turns the
 * text of a file into either a validated BackupFile or the reason it was
 * refused. It does not check references between rows (that happens after the
 * merge, over the merged result) and it writes nothing.
 */
import type {
  BodyweightEntry, Cycle, Exercise, Goal, LoggedSet, Routine, Session, Settings,
} from '../db/types';
import { isPlausibleTime, validateTables } from './backupValidate';

export const BACKUP_FORMAT = 'workout-tracker-backup';
/** Changes only when the shape of a row in the file changes, not when a Dexie
 *  index does. */
export const BACKUP_FORMAT_VERSION = 1;

export const TABLE_NAMES = [
  'exercises', 'routines', 'cycles', 'sessions', 'sets', 'bodyweight', 'goals', 'settings',
] as const;

export interface BackupTables {
  exercises: Exercise[];
  routines: Routine[];
  cycles: Cycle[];
  sessions: Session[];
  sets: LoggedSet[];
  bodyweight: BodyweightEntry[];
  goals: Goal[];
  settings: Settings[];
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  exportedAt: number;
  /** Recorded for diagnosis only. */
  dbVersion: number;
  /** Recorded for diagnosis only. */
  libraryVersion: number;
  tables: BackupTables;
}

export function buildBackup(
  tables: BackupTables,
  meta: { exportedAt: number; dbVersion: number; libraryVersion: number },
): BackupFile {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: meta.exportedAt,
    dbVersion: meta.dbVersion,
    libraryVersion: meta.libraryVersion,
    tables,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `workout-backup-YYYY-MM-DD-HHMM.json`, in the phone's local time. */
export function backupFileName(exportedAt: number): string {
  const d = new Date(exportedAt);
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `workout-backup-${day}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

export type ParsedBackup =
  | { ok: true; file: BackupFile }
  | { ok: false; reason: 'newer' | 'not-backup' | 'damaged'; detail: string };

/** One step per format version, run in order on a file older than this build.
 *  Empty: version 1 is the first. A step for version N turns a version-N
 *  document into a version-(N+1) one. */
const UPGRADES: Record<number, (raw: unknown) => unknown> = {};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const refuse = (reason: 'newer' | 'not-backup' | 'damaged', detail: string): ParsedBackup =>
  ({ ok: false, reason, detail });

export function parseBackup(text: string, now: number): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return refuse('not-backup', "The file isn't valid JSON.");
  }
  if (!isRecord(raw) || raw.format !== BACKUP_FORMAT) {
    return refuse('not-backup', "The file isn't a workout backup.");
  }

  const version = raw.formatVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return refuse('damaged', '"formatVersion" is not a whole number.');
  }
  if (version > BACKUP_FORMAT_VERSION) {
    return refuse(
      'newer',
      `It was made by format version ${version}; this app reads up to ${BACKUP_FORMAT_VERSION}.`,
    );
  }

  let doc: unknown = raw;
  for (let v = version; v < BACKUP_FORMAT_VERSION; v++) doc = UPGRADES[v](doc);
  const file = doc as Record<string, unknown>;

  const tables = isRecord(file.tables) ? file.tables : {};
  for (const name of TABLE_NAMES) {
    if (!Array.isArray(tables[name])) return refuse('damaged', `The "${name}" table is missing.`);
  }

  if (!isPlausibleTime(file.exportedAt, now)) {
    return refuse('damaged', '"exportedAt" is not a plausible time.');
  }

  const problem = validateTables(tables as unknown as BackupTables, now);
  if (problem !== null) return refuse('damaged', problem);

  return { ok: true, file: file as unknown as BackupFile };
}
