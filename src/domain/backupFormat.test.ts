import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION, backupFileName, buildBackup, parseBackup } from './backupFormat';
import { EARLIEST_PLAUSIBLE_TIME } from './backupValidate';
import { DAY, NOW, backupFile, fullTables } from './backupTestRows';

it('names the file in local time', () => {
  // 03:05 UTC on the 21st is 22:05 on the 20th in Chicago (CDT): a
  // toISOString-based name would say the 21st.
  expect(backupFileName(Date.UTC(2026, 9, 21, 3, 5))).toBe('workout-backup-2026-10-20-2205.json');
  expect(backupFileName(Date.UTC(2026, 0, 2, 15, 7))).toBe('workout-backup-2026-01-02-0907.json');
});

it('builds the envelope around the tables', () => {
  const tables = fullTables();
  const file = buildBackup(tables, { exportedAt: NOW - DAY, dbVersion: 1, libraryVersion: 2 });
  expect(file).toEqual({
    format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: NOW - DAY, dbVersion: 1, libraryVersion: 2, tables,
  });
});

it('parses its own output back to an equal file', () => {
  const file = backupFile(fullTables());
  expect(parseBackup(JSON.stringify(file), NOW)).toEqual({ ok: true, file });
});

it.each([
  ['not JSON', '{"format": ', 'not-backup', "The file isn't valid JSON."],
  ['a JSON array', '[]', 'not-backup', "The file isn't a workout backup."],
  ['another format', JSON.stringify({ format: 'something-else' }), 'not-backup', "The file isn't a workout backup."],
])('refuses %s', (_label, text, reason, detail) => {
  expect(parseBackup(text, NOW)).toEqual({ ok: false, reason, detail });
});

it('refuses a newer format version as newer, not damaged', () => {
  const text = JSON.stringify({ ...backupFile(fullTables()), formatVersion: BACKUP_FORMAT_VERSION + 1 });
  expect(parseBackup(text, NOW)).toEqual({
    ok: false, reason: 'newer',
    detail: `It was made by format version ${BACKUP_FORMAT_VERSION + 1}; this app reads up to ${BACKUP_FORMAT_VERSION}.`,
  });
});

it.each([0, 1.5, '1'])('refuses a format version of %j as damaged', (formatVersion) => {
  const text = JSON.stringify({ ...backupFile(fullTables()), formatVersion });
  expect(parseBackup(text, NOW)).toMatchObject({ ok: false, reason: 'damaged' });
});

it('refuses a file missing a table', () => {
  const file = backupFile(fullTables());
  const { goals: _goals, ...tables } = file.tables;
  expect(parseBackup(JSON.stringify({ ...file, tables }), NOW))
    .toEqual({ ok: false, reason: 'damaged', detail: 'The "goals" table is missing.' });
  expect(parseBackup(JSON.stringify({ ...file, tables: 'nope' }), NOW))
    .toMatchObject({ ok: false, reason: 'damaged', detail: 'The "exercises" table is missing.' });
});

it('refuses rows that fail validation, with the validator\'s message', () => {
  const file = backupFile(fullTables());
  file.tables.sets[0].weight = null as never; // what Infinity becomes in JSON
  const result = parseBackup(JSON.stringify(file), NOW);
  expect(result).toMatchObject({ ok: false, reason: 'damaged' });
  expect(result.ok === false && result.detail).toMatch(/^A set in workout "Upper A" on .+: "weight" is not a finite number\.$/);
});

it.each([
  ['before 2000', EARLIEST_PLAUSIBLE_TIME - 1],
  ['more than a day ahead', NOW + 2 * DAY],
  ['null, which is what NaN becomes in JSON', null],
])('refuses an exportedAt that is %s', (_label, exportedAt) => {
  const text = JSON.stringify({ ...backupFile(fullTables()), exportedAt });
  expect(parseBackup(text, NOW)).toEqual({
    ok: false, reason: 'damaged', detail: '"exportedAt" is not a plausible time.',
  });
});

it('keeps fields it does not know, on the file and on its rows', () => {
  const file = backupFile(fullTables());
  const extended = {
    ...file,
    addedLater: 'x',
    tables: { ...file.tables, sets: [{ ...file.tables.sets[0], tags: ['a'] }] },
  };
  expect(parseBackup(JSON.stringify(extended), NOW)).toEqual({ ok: true, file: extended });
});

it('does not check references, which are checked after the merge', () => {
  const file = backupFile(fullTables());
  file.tables.sets[0].exerciseId = 'only-on-the-phone';
  expect(parseBackup(JSON.stringify(file), NOW).ok).toBe(true);
});
