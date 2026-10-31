import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import bundled from '../../data/exercises.json';
import { applyRestore } from '../../db/backup';
import { getOrCreateActiveCycle, saveCycle } from '../../db/cycles';
import { db, resetDbForTests } from '../../db/db';
import { createRoutine } from '../../db/routines';
import { prepareLibrary } from '../../db/seed';
import { getSettings, updateSettings } from '../../db/settings';
import type { Exercise } from '../../db/types';
import type { MergeSummary } from '../../domain/backupMerge';
import {
  backupFile, exerciseRow, fullTables, routineRow, sessionRow, setRow,
} from '../../domain/backupTestRows';
import { DAY, seedExercise, seedWorkout, T } from '../../testFixtures';
import { RestoreControl } from './RestoreControl';

// applyRestore stays the real function, so a test can restore for real. The
// one test that must hold it open swaps in its own promise for a single call:
// awaiting a foreign promise inside a Dexie transaction commits it early.
vi.mock('../../db/backup', async (orig) => {
  const real = await orig<typeof import('../../db/backup')>();
  return { ...real, applyRestore: vi.fn(real.applyRestore) };
});

beforeEach(async () => {
  await resetDbForTests();
  await prepareLibrary();
  vi.mocked(applyRestore).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const FILE_NAME = 'workout-backup-2026-10-20-2205.json';
const LABEL = 'Restore from backup…';

const NEWER = /^This backup can't be restored\. It was made by a newer version of the app\. Open the app while you're online so it updates, then try again\. Nothing on this phone was changed\.$/;
const NOT_A_BACKUP = /^This isn't a workout backup, or it's damaged\. Nothing on this phone was changed\.$/;
const IN_PROGRESS_REFUSAL = /^Finish or discard your workout in progress before restoring\. Nothing on this phone was changed\.$/;
const ALREADY_HERE = /^Everything in this backup is already on this phone\.$/;

/** Every table's rows, exactly as stored. */
async function dump() {
  return Object.fromEntries(
    await Promise.all(db.tables.map(async (t) => [t.name, await t.toArray()])),
  );
}

/** A backup made a day ago, as the text of a file. */
function backupText(tables = fullTables(), exportedAt = Date.now() - DAY) {
  return JSON.stringify(backupFile(tables, exportedAt));
}

function jsonFile(text: string, name = FILE_NAME) {
  return new File([text], name, { type: 'application/json' });
}

/** Chooses a file in the picker. Re-queries the input each time. */
function choose(user: UserEvent, file: File) {
  return user.upload(screen.getByLabelText(LABEL), file);
}

/** The text of every item in the list, in order. */
function listedItems() {
  return within(screen.getByRole('list'))
    .getAllByRole('listitem')
    .map((item) => item.textContent);
}

async function renderAndChoose(text: string, name = FILE_NAME) {
  const user = userEvent.setup();
  render(<RestoreControl inProgress={false} />);
  await choose(user, jsonFile(text, name));
  return user;
}

async function confirmation() {
  return screen.findByRole('heading', { name: 'Restore this backup?' });
}

it('shows what a backup adds before writing anything', async () => {
  // Rejects: applying while previewing.
  const exportedAt = Date.now() - DAY;
  const before = await dump();
  await renderAndChoose(backupText(fullTables(), exportedAt));

  expect(await confirmation()).toBeInTheDocument();
  expect(screen.getByText(FILE_NAME)).toBeInTheDocument();
  expect(screen.getByText(`Made ${new Date(exportedAt).toLocaleString()}`)).toBeInTheDocument();
  expect(screen.getByText('This adds:')).toBeInTheDocument();
  expect(listedItems()).toEqual(['1 workout (1 set)', '1 routine', '1 custom exercise']);
  expect(screen.getByText(/^Nothing already on this phone is removed\./)).toHaveTextContent(
    /^Nothing already on this phone is removed\. Settings switch to the backup's: kg, 120 s rest, sound off\.$/,
  );
  expect(screen.getByRole('button', { name: 'Restore' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();

  expect(await db.sessions.count()).toBe(0);
  expect(await dump()).toEqual(before);
  expect(applyRestore).not.toHaveBeenCalled();
});

it('restores on confirm and says what it added', async () => {
  const user = await renderAndChoose(backupText());
  await confirmation();

  await user.click(screen.getByRole('button', { name: 'Restore' }));

  expect(await screen.findByRole('status')).toHaveTextContent(/^Restored\.$/);
  expect(await db.sessions.get('w-1')).toBeDefined();
  expect(listedItems()).toEqual(['1 workout (1 set)', '1 routine', '1 custom exercise']);
  expect((await getSettings()).unitPreference).toBe('kg');
  // The confirmation has done its job.
  expect(screen.queryByRole('heading', { name: 'Restore this backup?' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
});

it('cancels without writing', async () => {
  // Rejects: a Cancel that restores, and one that leaves the confirmation up.
  const before = await dump();
  const user = await renderAndChoose(backupText());
  await confirmation();

  await user.click(screen.getByRole('button', { name: 'Cancel' }));

  expect(screen.queryByRole('heading', { name: 'Restore this backup?' })).toBeNull();
  expect(screen.queryByRole('list')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByLabelText(LABEL)).toBeInTheDocument();
  expect(applyRestore).not.toHaveBeenCalled();
  expect(await dump()).toEqual(before);
});

it('lets the same file be chosen again after Cancel', async () => {
  // Rejects: leaving the file in the input, where choosing it again fires no change.
  const file = jsonFile(backupText());
  const user = userEvent.setup();
  render(<RestoreControl inProgress={false} />);
  await choose(user, file);
  await confirmation();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('heading', { name: 'Restore this backup?' })).toBeNull();

  await choose(user, file);

  expect(await confirmation()).toBeInTheDocument();
});

it('names a matched exercise and a replaced rotation', async () => {
  await seedExercise('Explosive Box Step-Up', 'bodyweight_reps');
  const phoneDay = await createRoutine('Phone Day');
  await saveCycle({ ...(await getOrCreateActiveCycle()), routineIds: [phoneDay.id] });

  await renderAndChoose(backupText());
  await confirmation();

  // The match replaces "1 custom exercise": the phone's copy is used instead.
  expect(listedItems()).toEqual([
    '1 workout (1 set)',
    '1 routine',
    'Explosive Box Step-Up: history joins the copy already on this phone',
    'Your rotation from the backup replaces the one on this phone',
  ]);
});

it('uses the plural for every count above one', async () => {
  const [first, second] = bundled as Exercise[];
  const tables = fullTables();
  tables.exercises.push(
    exerciseRow({ id: 'ex-two', name: 'Second Custom' }),
    { ...first, isArchived: !first.isArchived },
    { ...second, isArchived: !second.isArchived },
  );
  tables.routines.push(routineRow({ id: 'r-two' }));
  tables.sessions.push(sessionRow({ id: 'w-2', startedAt: T + 2 * DAY, endedAt: T + 2 * DAY + 1000 }));
  tables.sets.push(
    setRow({ id: 's-2', sessionId: 'w-2', exerciseId: 'ex-two', order: 0, completedAt: T + 2 * DAY + 10 }),
    setRow({ id: 's-3', sessionId: 'w-2', exerciseId: 'ex-two', order: 1, completedAt: T + 2 * DAY + 20 }),
  );
  await renderAndChoose(backupText(tables));
  await confirmation();

  expect(listedItems()).toEqual([
    '2 workouts (3 sets)',
    '2 routines',
    '2 custom exercises',
    'your edits to 2 library exercises',
  ]);
});

it('counts sets that join a workout already on the phone, and one library edit', async () => {
  // The phone already has w-1, so the backup adds a set to it and no workout.
  const [first] = bundled as Exercise[];
  await db.sessions.put(sessionRow({ id: 'w-1', startedAt: fullTables().sessions[0].startedAt }));
  const tables = fullTables();
  tables.exercises.push({ ...first, isArchived: !first.isArchived });

  await renderAndChoose(backupText(tables));
  await confirmation();

  expect(listedItems()).toEqual([
    '1 set in workouts already on this phone',
    '1 routine',
    '1 custom exercise',
    'your edits to 1 library exercise',
  ]);
});

it('says nothing about a count that is zero', async () => {
  // Rejects: listing "0 routines". Only the routine is new here.
  const tables = fullTables();
  tables.sessions = [];
  tables.sets = [];
  tables.goals = [];
  tables.exercises = [];
  tables.routines[0].items = [];
  await renderAndChoose(backupText(tables));
  await confirmation();

  expect(listedItems()).toEqual(['1 routine']);
});

it('refuses a newer backup, changing nothing', async () => {
  // Rejects: applying a file the app can't read.
  const before = await dump();
  await renderAndChoose(JSON.stringify({ ...backupFile(fullTables()), formatVersion: 2 }));

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(NEWER);
  expect(alert.querySelector('small')).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Restore this backup?' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
  expect(await db.sessions.count()).toBe(0);
  expect(await dump()).toEqual(before);
  expect(applyRestore).not.toHaveBeenCalled();
});

it('refuses a damaged file with the reason in small print', async () => {
  await renderAndChoose('{"format": ');

  const alert = await screen.findByRole('alert');
  expect(within(alert).getByText(NOT_A_BACKUP).tagName).toBe('P');
  expect(within(alert).getByText("The file isn't valid JSON.").tagName).toBe('SMALL');
  expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
});

it('gives the first problem in a damaged backup the same way', async () => {
  // Rejects: showing the detail for a file that isn't a backup but not for one
  // that is damaged.
  const { goals: _dropped, ...withoutGoals } = fullTables();
  await renderAndChoose(JSON.stringify({ ...backupFile(fullTables()), tables: withoutGoals }));

  const alert = await screen.findByRole('alert');
  expect(within(alert).getByText(NOT_A_BACKUP).tagName).toBe('P');
  expect(within(alert).getByText('The "goals" table is missing.').tagName).toBe('SMALL');
});

it('refuses when a workout was started since the picker opened', async () => {
  // The control was told there was no workout; the database says otherwise.
  await seedWorkout({ startedAt: T, status: 'in_progress', endedAt: null });
  await renderAndChoose(backupText());

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(IN_PROGRESS_REFUSAL);
  expect(alert.querySelector('small')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
  expect(await db.sessions.count()).toBe(1);
});

it('says when everything is already here, and writes nothing', async () => {
  // Rejects: a Restore that is offered anyway, and one that is applied behind
  // the message, which would switch the settings back to the backup's.
  const file = backupFile(fullTables(), Date.now() - DAY);
  await applyRestore(file);
  await updateSettings({ unitPreference: 'lb' });
  vi.mocked(applyRestore).mockClear();
  const before = await dump();

  await renderAndChoose(JSON.stringify(file));

  expect(await screen.findByRole('status')).toHaveTextContent(ALREADY_HERE);
  expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Restore this backup?' })).toBeNull();
  expect(applyRestore).not.toHaveBeenCalled();
  expect((await getSettings()).unitPreference).toBe('lb');
  expect(await dump()).toEqual(before);
});

it('offers a restore when the only news is something the list leaves out', async () => {
  // Rejects: deciding "already here" from the counts. A goal is written by a
  // restore but is not one of them.
  const file = backupFile(fullTables(), Date.now() - DAY);
  await applyRestore(file);
  await db.goals.delete('g-1');
  vi.mocked(applyRestore).mockClear();

  const user = await renderAndChoose(JSON.stringify(file));

  expect(await confirmation()).toBeInTheDocument();
  expect(screen.queryByText(ALREADY_HERE)).toBeNull();
  // Nothing to list, so no "This adds:" with nothing under it.
  expect(screen.queryByText('This adds:')).toBeNull();
  expect(screen.queryByRole('list')).toBeNull();

  await user.click(screen.getByRole('button', { name: 'Restore' }));

  expect(await screen.findByRole('status')).toHaveTextContent(/^Restored\.$/);
  expect(await db.goals.get('g-1')).toBeDefined();
});

it('disables Restore while it runs', async () => {
  // Rejects: a Restore that can be tapped again, which would start a second
  // write, and a Cancel or a picker that stays live under a write in flight.
  let release!: (summary: MergeSummary) => void;
  const held = new Promise<MergeSummary>((resolve) => { release = resolve; });
  vi.mocked(applyRestore).mockImplementationOnce(() => held);
  const user = await renderAndChoose(backupText());
  await confirmation();

  await user.click(screen.getByRole('button', { name: 'Restore' }));

  expect(screen.getByRole('button', { name: 'Restore' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  expect(screen.getByLabelText(LABEL)).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Restore' }));
  expect(applyRestore).toHaveBeenCalledTimes(1);

  // What it says was added is what applyRestore reports, not the preview.
  release({
    workouts: 3, sets: 4, routines: 0, customExercises: 2, libraryEdits: 0,
    matchedExercises: [], rotationReplaced: false,
    settings: { unitPreference: 'kg', defaultRestSeconds: 120, restAlertSound: false },
  });
  expect(await screen.findByRole('status')).toHaveTextContent(/^Restored\.$/);
  expect(listedItems()).toEqual(['3 workouts (4 sets)', '2 custom exercises']);
  expect(screen.getByLabelText(LABEL)).toBeEnabled();
});

it('keeps the confirmation and says why when the restore fails', async () => {
  // The preview saw no workout; one was started before Restore was tapped, and
  // the merge, planned again inside the transaction, refuses.
  const user = await renderAndChoose(backupText());
  await confirmation();
  await seedWorkout({ startedAt: T, status: 'in_progress', endedAt: null });

  await user.click(screen.getByRole('button', { name: 'Restore' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    /^Finish or discard your workout in progress before restoring\.$/,
  );
  expect(screen.getByRole('heading', { name: 'Restore this backup?' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Restore' })).toBeEnabled();
  expect(screen.queryByRole('status')).toBeNull();
  expect(await db.sessions.get('w-1')).toBeUndefined();

  // Cancel takes the failure away with the confirmation.
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('alert')).toBeNull();
});

it('says why when the file cannot be read, and recovers on the next one', async () => {
  // Rejects: a rejected file.text() that nobody catches. An iCloud file that
  // has not downloaded yet fails this way.
  const unreadable = jsonFile('x', 'cloud.json');
  Object.defineProperty(unreadable, 'text', {
    value: () => Promise.reject(new Error("Couldn't read that file.")),
  });
  const user = userEvent.setup();
  render(<RestoreControl inProgress={false} />);

  await choose(user, unreadable);

  expect(await screen.findByRole('alert')).toHaveTextContent(/^Couldn't read that file\.$/);
  expect(screen.queryByRole('heading', { name: 'Restore this backup?' })).toBeNull();

  await choose(user, jsonFile(backupText()));

  expect(await confirmation()).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('is disabled while a workout is in progress', async () => {
  // Rejects: a picker that is still there under the explanation.
  const { container } = render(<RestoreControl inProgress />);

  expect(screen.getByRole('button', { name: LABEL })).toBeDisabled();
  expect(screen.getByText(/^Finish or discard your workout in progress before restoring\.$/)).toBeInTheDocument();
  expect(screen.queryByLabelText(LABEL)).toBeNull();
  expect(container.querySelector('input[type="file"]')).toBeNull();
});

it('offers a file picker for JSON when no workout is in progress', () => {
  const { container } = render(<RestoreControl inProgress={false} />);

  expect(screen.getByLabelText(LABEL)).toHaveAttribute('accept', '.json,application/json');
  expect(screen.queryByRole('button', { name: LABEL })).toBeNull();
  expect(screen.queryByText(/Finish or discard/)).toBeNull();
  expect(container.querySelector('input[type="file"]')).toBe(screen.getByLabelText(LABEL));
});
