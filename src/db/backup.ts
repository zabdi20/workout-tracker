/**
 * Backing up and restoring the database.
 *
 * The thin I/O layer over src/domain/backup*: it reads a snapshot, hands it
 * to the pure functions, and writes what they decide. Every rule lives in the
 * domain. This file decides only where the rows come from and when they are
 * written: all of them in one transaction, or none.
 *
 * Imports the bundled library from the JSON, not from ./seed: seed.ts is the
 * module the startup tests replace, and a backup must not depend on it.
 */
import { db, SETTINGS_ID } from './db';
import { DEFAULT_SETTINGS, updateSettings } from './settings';
import type { Exercise } from './types';
import bundled from '../data/exercises.json';
import {
  backupFileName, buildBackup, parseBackup,
} from '../domain/backupFormat';
import type { BackupFile, BackupTables } from '../domain/backupFormat';
import { addsNothing, planMerge } from '../domain/backupMerge';
import type { MergeSummary } from '../domain/backupMerge';
import { checkReferences, validateTables } from '../domain/backupValidate';

// ---- Reading ---------------------------------------------------------------

/**
 * Every table's rows. Run it inside a transaction that spans db.tables, or
 * the tables are read one at a time and can disagree.
 *
 * `settings` is always exactly one row: the stored row over the defaults, as
 * getSettings reads it. A row written by an older build, missing a field
 * added since, would otherwise fail validation on a backup of a phone that is
 * working fine, and planMerge needs a phone row to compare with.
 */
async function readTables(): Promise<BackupTables> {
  const [exercises, routines, cycles, sessions, sets, bodyweight, goals, stored] = await Promise.all([
    db.exercises.toArray(),
    db.routines.toArray(),
    db.cycles.toArray(),
    db.sessions.toArray(),
    db.sets.toArray(),
    db.bodyweight.toArray(),
    db.goals.toArray(),
    db.settings.get(SETTINGS_ID),
  ]);
  return {
    exercises, routines, cycles, sessions, sets, bodyweight, goals,
    settings: [{ ...DEFAULT_SETTINGS, ...stored }],
  };
}

/**
 * A consistent snapshot of the whole database, in one read-only transaction,
 * so a backup taken while something else writes still describes one moment.
 * Read-only, so it is safe to call from inside a useLiveQuery querier.
 */
export function readSnapshot(): Promise<BackupTables> {
  return db.transaction('r', db.tables, readTables);
}

// ---- Backing up ------------------------------------------------------------

export interface PreparedBackup {
  file: BackupFile;
  /** The file's contents, ready to save. */
  text: string;
  name: string;
  /** The first thing wrong with the snapshot that would stop it restoring, or
   *  null. The file is offered either way: a backup with one bad row beats none. */
  problem: string | null;
}

/**
 * Builds the backup file from the database as it is now. Writes nothing:
 * `lastBackupAt` is recorded by recordBackup, once the file has actually been
 * saved, and never for a file the user backed out of.
 */
export async function createBackup(now = Date.now()): Promise<PreparedBackup> {
  const tables = await readSnapshot();
  const file = buildBackup(tables, {
    exportedAt: now,
    dbVersion: db.verno,
    libraryVersion: tables.settings[0].libraryVersion ?? 0,
  });
  return {
    file,
    text: JSON.stringify(file),
    name: backupFileName(now),
    // checkReferences assumes validateTables passed, so it only runs after it.
    problem: validateTables(tables, now) ?? checkReferences(tables),
  };
}

/** Records that the backup made at `exportedAt` was saved. */
export function recordBackup(exportedAt: number): Promise<void> {
  return updateSettings({ lastBackupAt: exportedAt });
}

// ---- Restoring -------------------------------------------------------------

export type RestorePreview =
  | { kind: 'refused'; reason: 'newer' | 'not-backup' | 'damaged' | 'in-progress'; detail: string }
  | { kind: 'ready'; file: BackupFile; summary: MergeSummary; nothingToAdd: boolean };

/**
 * Reads a backup's text and says what restoring it would do, or why it can't.
 * Writes nothing. `nothingToAdd` is true when the restore would add no rows
 * (see addsNothing), so the screen can offer no Restore at all.
 */
export async function previewRestore(text: string, now = Date.now()): Promise<RestorePreview> {
  const parsed = parseBackup(text, now);
  if (!parsed.ok) return { kind: 'refused', reason: parsed.reason, detail: parsed.detail };

  const merge = planMerge(await readSnapshot(), parsed.file, bundled as Exercise[]);
  if (!merge.ok) return { kind: 'refused', reason: merge.reason, detail: merge.detail };

  return {
    kind: 'ready',
    file: parsed.file,
    summary: merge.plan.summary,
    nothingToAdd: addsNothing(merge.plan),
  };
}

/**
 * Applies a parsed backup, all of it or none of it, and returns what it added.
 *
 * The merge is planned again inside the transaction, from fresh reads, not
 * replayed from the preview: if the phone changed since the user saw the
 * confirmation, the restore merges against what is actually there, as
 * moveSession computes its shift from a fresh read. A refusal at this point
 * throws, and the transaction writes nothing.
 *
 * Tables are written in dependency order, settings last. It applies whatever
 * the plan holds, settings included, so it is the caller's job not to call it
 * when the preview said there was nothing to add.
 *
 * NEVER call this from inside a useLiveQuery querier: it opens a readwrite
 * transaction and Dexie throws ReadOnlyError.
 */
export async function applyRestore(file: BackupFile): Promise<MergeSummary> {
  return db.transaction('rw', db.tables, async () => {
    const merge = planMerge(await readTables(), file, bundled as Exercise[]);
    if (!merge.ok) throw new Error(merge.detail);

    const { put, deleteCycleIds, summary } = merge.plan;
    await db.exercises.bulkPut(put.exercises);
    await db.routines.bulkPut(put.routines);
    await db.cycles.bulkPut(put.cycles);
    await db.cycles.bulkDelete(deleteCycleIds);
    await db.sessions.bulkPut(put.sessions);
    await db.sets.bulkPut(put.sets);
    await db.bodyweight.bulkPut(put.bodyweight);
    await db.goals.bulkPut(put.goals);
    for (const row of put.settings) await db.settings.put(row);
    return summary;
  });
}
