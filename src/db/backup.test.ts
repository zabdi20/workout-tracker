import { db, SETTINGS_ID, resetDbForTests } from './db';
import { prepareLibrary, LIBRARY_VERSION } from './seed';
import { DEFAULT_SETTINGS, getSettings } from './settings';
import {
  applyRestore, createBackup, previewRestore, readSnapshot, recordBackup,
} from './backup';
import { backupFileName, parseBackup, TABLE_NAMES } from '../domain/backupFormat';
import { validateTables } from '../domain/backupValidate';
import { fullTables, backupFile, NOW, sessionRow } from '../domain/backupTestRows';
import bundled from '../data/exercises.json';
import { seedExercise, seedWorkout, T, MIN, DAY } from '../testFixtures';

beforeEach(async () => {
  await resetDbForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Every table's rows, exactly as stored. */
async function dump() {
  return Object.fromEntries(
    await Promise.all(db.tables.map(async (t) => [t.name, await t.toArray()])),
  );
}

/** A valid backup and its text. */
function validBackup() {
  const file = backupFile(fullTables());
  return { file, text: JSON.stringify(file) };
}

const ZERO_COUNTS = {
  workouts: 0, sets: 0, routines: 0, customExercises: 0, libraryEdits: 0,
  matchedExercises: [], rotationReplaced: false,
};

// ---- Reading the snapshot --------------------------------------------------

it('reads the snapshot without opening a read-write transaction', async () => {
  // Rejects: a snapshot taken in 'rw' mode, which Dexie refuses to nest inside
  // a read-only scope (a useLiveQuery querier is one).
  await expect(db.transaction('r', db.tables, () => readSnapshot())).resolves.toBeDefined();
});

// ---- Backing up ------------------------------------------------------------

it('fills settings defaults into the snapshot', async () => {
  // A row written before restAlertSound existed; Review Focus 3.
  await db.settings.put({ id: SETTINGS_ID, unitPreference: 'kg', defaultRestSeconds: 60 } as never);
  const { file, problem } = await createBackup();
  expect(file.tables.settings).toEqual([{ ...DEFAULT_SETTINGS, unitPreference: 'kg', defaultRestSeconds: 60 }]);
  expect(problem).toBeNull();
});

it('writes a file that parses back to the database exactly', async () => {
  // Rejects: an exporter that drops, rounds or converts anything.
  const ex = await seedExercise();
  await seedWorkout({ startedAt: T + 7, sets: [
    { exerciseId: ex.id, weight: 22.5, reps: 8, completedAt: T + MIN + 3 },
    { exerciseId: ex.id, weight: 60, unit: 'kg', reps: 5, setType: 'warmup', completedAt: T + 2 * MIN + 9 },
  ] });
  const prepared = await createBackup(T + DAY);
  const parsed = parseBackup(prepared.text, T + DAY);
  if (!parsed.ok) throw new Error(parsed.detail);
  const rows = await dump();
  for (const name of TABLE_NAMES.filter((n) => n !== 'settings')) {
    expect(parsed.file.tables[name]).toEqual(rows[name]);
  }
  expect(parsed.file.tables.sets).toHaveLength(2);
  expect(prepared.name).toBe(backupFileName(T + DAY));
  expect(parsed.file.exportedAt).toBe(T + DAY);
});

it('writes every table, with every optional field, exactly as stored', async () => {
  // Rejects: an exporter that leaves out a table or an optional field. The
  // workout seeds above leave routines, rotations, goals and bodyweight empty.
  const rows = fullTables();
  await db.transaction('rw', db.tables, async () => {
    await db.exercises.bulkPut(rows.exercises);
    await db.routines.bulkPut(rows.routines);
    await db.cycles.bulkPut(rows.cycles);
    await db.sessions.bulkPut(rows.sessions);
    await db.sets.bulkPut(rows.sets);
    await db.bodyweight.bulkPut(rows.bodyweight);
    await db.goals.bulkPut(rows.goals);
    await db.settings.put(rows.settings[0]);
  });
  const { file, problem } = await createBackup(T + 40 * DAY);
  expect(file.tables).toEqual(fullTables());
  expect(problem).toBeNull();
});

it('records the database and library versions', async () => {
  // Rejects: constants in place of what is on the phone.
  expect((await createBackup()).file).toMatchObject({ dbVersion: db.verno, libraryVersion: 0 });
  await prepareLibrary();
  expect((await createBackup()).file).toMatchObject({ dbVersion: db.verno, libraryVersion: LIBRARY_VERSION });
});

it('accepts the bundled library exactly as prepareLibrary stores it', async () => {
  // Rejects: a build:exercises revision with a row the validator refuses.
  // prepareLibrary would store it without complaint, and every backup made on
  // a fresh phone would then fail its own check and be refused on restore.
  await prepareLibrary();
  const stored = await db.exercises.toArray();
  // Non-vacuity: every bundled row was in what was checked.
  expect(stored).toHaveLength(bundled.length);

  expect(validateTables({ ...fullTables(), exercises: stored }, NOW)).toBeNull();
});

it('creating a backup records nothing', async () => {
  // Rejects: recording on create. Recording is for after the share sheet resolves.
  await seedWorkout({ startedAt: T });
  const before = await dump();
  await createBackup();
  expect((await getSettings()).lastBackupAt).toBeUndefined();
  expect(await dump()).toEqual(before);
});

it('still builds a backup from a flawed snapshot, naming the problem', async () => {
  // Rejects: refusing to save a backup because one row is bad.
  await seedWorkout({ name: 'Moved Push', startedAt: Date.UTC(1999, 5, 1, 17) });
  const { text, problem } = await createBackup();
  expect(JSON.parse(text).tables.sessions.map((s: { name: string }) => s.name)).toEqual(['Moved Push']);
  expect(problem).toMatch(/^Workout "Moved Push" on .+: "startedAt" is before 2000\.$/);
});

it('recordBackup stamps the time and keeps the other settings', async () => {
  // Rejects: a put of the new field alone, which would drop everything else.
  await db.settings.put({ ...DEFAULT_SETTINGS, unitPreference: 'kg', defaultRestSeconds: 75, libraryVersion: 2 });
  await recordBackup(T + 5);
  expect(await db.settings.toArray()).toEqual([
    { ...DEFAULT_SETTINGS, unitPreference: 'kg', defaultRestSeconds: 75, libraryVersion: 2, lastBackupAt: T + 5 },
  ]);
});

// ---- Previewing a restore --------------------------------------------------

it('previews without writing', async () => {
  // Rejects: a preview that applies what it plans.
  await prepareLibrary();
  const { text } = validBackup();
  const before = await dump();
  const preview = await previewRestore(text);
  expect(await dump()).toEqual(before);
  if (preview.kind !== 'ready') throw new Error(`${preview.reason}: ${preview.detail}`);
  expect(preview.summary).toMatchObject({
    workouts: 1, sets: 1, routines: 1, customExercises: 1, libraryEdits: 0, rotationReplaced: false,
  });
  expect(preview.nothingToAdd).toBe(false);
});

it('refuses to preview while a workout is in progress', async () => {
  await seedWorkout({ startedAt: T, status: 'in_progress', endedAt: null });
  const preview = await previewRestore(validBackup().text);
  expect(preview).toMatchObject({ kind: 'refused', reason: 'in-progress' });
});

it('passes a newer-version refusal through', async () => {
  // Rejects: a preview that maps every parse refusal to one reason.
  const text = JSON.stringify({ ...validBackup().file, formatVersion: 2 });
  expect(await previewRestore(text)).toMatchObject({ kind: 'refused', reason: 'newer', detail: expect.stringMatching(/version 2/) });
});

it('passes the other parse refusals through, with their detail', async () => {
  expect(await previewRestore('{"hello":1}')).toEqual({
    kind: 'refused', reason: 'not-backup', detail: "The file isn't a workout backup.",
  });
  const { tables: _dropped, ...noTables } = validBackup().file;
  expect(await previewRestore(JSON.stringify(noTables))).toEqual({
    kind: 'refused', reason: 'damaged', detail: 'The "exercises" table is missing.',
  });
});

it('refuses a backup whose rows point at something nobody has', async () => {
  // Rejects: checking references against the file alone, or not at all. The
  // phone has no library here, so the set's exercise is nowhere.
  const text = JSON.stringify(backupFile({ ...fullTables(), exercises: [] }));
  const before = await dump();
  const preview = await previewRestore(text);
  expect(preview).toMatchObject({ kind: 'refused', reason: 'damaged' });
  expect(await dump()).toEqual(before);
});

// ---- Applying a restore ----------------------------------------------------

it('applies a restore and returns what it added', async () => {
  await prepareLibrary(); // so the phone looks real
  const libraryCount = await db.exercises.count();
  const file = backupFile(fullTables());
  const summary = await applyRestore(file);

  for (const name of ['exercises', 'routines', 'cycles', 'sessions', 'sets', 'bodyweight', 'goals'] as const) {
    for (const row of file.tables[name]) {
      expect(await db.table(name).get(row.id)).toEqual(row);
    }
  }
  expect(await db.exercises.count()).toBe(libraryCount + 1);
  expect(summary).toMatchObject({ workouts: 1, sets: 1, routines: 1, customExercises: 1 });
  expect(await getSettings()).toEqual({
    ...fullTables().settings[0],
    libraryVersion: LIBRARY_VERSION,
    lastBackupAt: file.exportedAt,
  });
});

it('adds nothing when the same file is applied twice', async () => {
  // Rejects: a restore that duplicates, or rewrites, what is already there.
  await prepareLibrary();
  const file = backupFile(fullTables());
  await applyRestore(file);
  const afterFirst = await dump();

  const second = await applyRestore(file);
  expect(second).toMatchObject(ZERO_COUNTS);
  expect(await dump()).toEqual(afterFirst);

  const preview = await previewRestore(JSON.stringify(file));
  if (preview.kind !== 'ready') throw new Error(`${preview.reason}: ${preview.detail}`);
  expect(preview.nothingToAdd).toBe(true);
});

it('writes nothing when the last write fails', async () => {
  // Rejects: one transaction per table. fullTables()'s settings differ from
  // the phone's defaults, so the settings write really happens, and last.
  await prepareLibrary();
  const file = backupFile(fullTables());
  const before = await dump();
  vi.spyOn(db.settings, 'put').mockRejectedValueOnce(new Error('disk on fire'));
  await expect(applyRestore(file)).rejects.toThrow('disk on fire');
  expect(await dump()).toEqual(before);
});

it('re-plans from what is on the phone when it applies', async () => {
  // Rejects: replaying the preview's plan, which would overwrite the phone's copy.
  const preview = await previewRestore(validBackup().text);
  if (preview.kind !== 'ready') throw new Error(`${preview.reason}: ${preview.detail}`);
  expect(preview.summary.workouts).toBe(1);

  // Between the preview and Restore, the phone gets its own w-1, moved a day on.
  const backupStart = fullTables().sessions[0].startedAt;
  const phoneStart = backupStart + DAY;
  await db.sessions.put(sessionRow({ id: 'w-1', name: 'Phone copy', startedAt: phoneStart, endedAt: phoneStart + MIN }));

  const summary = await applyRestore(preview.file);
  expect((await db.sessions.get('w-1'))?.name).toBe('Phone copy');
  expect(await db.sessions.count()).toBe(1);
  expect(summary.workouts).toBe(0);
  // The backup's set joins the phone's w-1, so it moves with it.
  expect(summary.sets).toBe(1);
  expect((await db.sets.get('s-1'))?.completedAt).toBe(fullTables().sets[0].completedAt + DAY);
});

it('refuses to apply while a workout is in progress, writing nothing', async () => {
  // Rejects: an apply that skips the in-progress rule it was previewed under.
  await prepareLibrary();
  await seedWorkout({ startedAt: T, status: 'in_progress', endedAt: null });
  const before = await dump();
  await expect(applyRestore(backupFile(fullTables()))).rejects.toThrow(
    /^Finish or discard your workout in progress before restoring\.$/,
  );
  expect(await dump()).toEqual(before);
});

it('refuses to apply rows that point at something nobody has, writing nothing', async () => {
  // Rejects: an apply that writes first and checks references afterwards.
  const file = backupFile({ ...fullTables(), exercises: [] });
  const before = await dump();
  await expect(applyRestore(file)).rejects.toThrow(/refers to an exercise that isn't there\.$/);
  expect(await dump()).toEqual(before);
});
