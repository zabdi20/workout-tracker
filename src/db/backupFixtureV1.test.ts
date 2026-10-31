/**
 * Restores the frozen version-1 backup, forever.
 *
 * fixtures/backup-v1.json was made once, by scripts/make-backup-fixture-v1.ts,
 * from the app's own write functions. Never regenerate it to make this test
 * pass: if a later change stops it restoring, that change broke the promise
 * that a file exported today restores after future migrations.
 */
import fixture from './fixtures/backup-v1.json';
import { db, resetDbForTests } from './db';
import { getOrCreateActiveCycle } from './cycles';
import { prepareLibrary } from './seed';
import { getSettings } from './settings';
import { applyRestore, previewRestore } from './backup';
import type { BackupFile } from '../domain/backupFormat';

it('restores the frozen version-1 backup onto a fresh install, row for row', async () => {
  await resetDbForTests();
  await prepareLibrary();
  await getOrCreateActiveCycle(); // what Today does on first open
  const preview = await previewRestore(JSON.stringify(fixture));
  if (preview.kind !== 'ready') throw new Error(`${preview.reason}: ${preview.detail}`);
  await applyRestore(preview.file);
  const f = fixture as unknown as BackupFile;
  for (const name of ['exercises', 'routines', 'cycles', 'sessions', 'sets', 'bodyweight', 'goals'] as const) {
    for (const row of f.tables[name]) {
      expect(await db.table(name).get(row.id)).toEqual(row);
    }
  }
  expect(await db.cycles.count()).toBe(f.tables.cycles.length); // the fresh empty one is gone
  expect(await db.sessions.where('status').equals('in_progress').count()).toBe(1);
  const s = await getSettings();
  expect([s.unitPreference, s.restAlertSound, s.lastBackupAt]).toEqual(['kg', false, f.exportedAt]);
});
