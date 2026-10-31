import { checkReferences, EARLIEST_PLAUSIBLE_TIME, validateTables } from './backupValidate';
import { DAY, NOW, T0, cycleRow, exerciseRow, fullTables, sessionRow, settingsRow } from './backupTestRows';
import type { BackupTables } from './backupFormat';

const date = (ms: number) => new Date(ms).toLocaleDateString();

it('accepts a clean backup with every optional field set', () => {
  expect(validateTables(fullTables(), NOW)).toBeNull();
  expect(checkReferences(fullTables())).toBeNull();
});

it('accepts the two nullable fields as null and a goal target in the future', () => {
  const t = fullTables();
  t.sessions[0].routineId = null;
  t.routines[0].items[0].supersetGroup = null;
  t.goals[0].targetDate = NOW + 3000 * DAY;
  expect(validateTables(t, NOW)).toBeNull();
});

const cases: Array<[string, (t: BackupTables) => void, string]> = [
  ['NaN weight', (t) => { t.sets[0].weight = NaN; }, `A set in workout "Upper A" on ${date(T0 + 123)}: "weight" is not a finite number.`],
  ['null reps', (t) => { t.sets[0].reps = null as never; }, `A set in workout "Upper A" on ${date(T0 + 123)}: "reps" is not a finite number.`],
  ['unknown measurement type', (t) => { t.exercises[0].measurementType = 'yoga' as never; }, 'Exercise "Explosive Box Step-Up": "measurementType" is not a known value.'],
  ['unknown muscle', (t) => { t.exercises[0].primaryMuscles = ['back' as never]; }, 'Exercise "Explosive Box Step-Up": "primaryMuscles" is not a known value.'],
  ['unknown unit', (t) => { t.sets[0].unit = 'stone' as never; }, `A set in workout "Upper A" on ${date(T0 + 123)}: "unit" is not a known value.`],
  ['missing session name', (t) => { delete (t.sessions[0] as Partial<typeof t.sessions[0]>).name; }, `Workout (w-1) on ${date(T0 + 123)}: "name" is missing.`],
  ['isArchived not boolean', (t) => { t.routines[0].isArchived = 'no' as never; }, 'Routine "Upper A": "isArchived" is not true or false.'],
  ['optional field as null', (t) => { t.sessions[0].notes = null as never; }, `Workout "Upper A" on ${date(T0 + 123)}: "notes" is not text.`],
  ['set in the future', (t) => { t.sets[0].completedAt = NOW + 2 * DAY; }, `A set in workout "Upper A" on ${date(T0 + 123)}: "completedAt" is in the future.`],
  ['goal created in the future', (t) => { t.goals[0].createdAt = NOW + 2 * DAY; }, 'Goal g-1: "createdAt" is in the future.'],
  ['duplicate id', (t) => { t.sessions.push(sessionRow({ id: 'w-1', name: 'Copy' })); }, `Workout "Copy" on ${date(T0)}: "id" is used twice.`],
  ['two in progress', (t) => { t.sessions[0].status = 'in_progress'; t.sessions.push(sessionRow({ id: 'w-2', status: 'in_progress' })); }, 'More than one workout is in progress.'],
  ['two active rotations', (t) => { t.cycles.push(cycleRow({ id: 'c-2', isActive: true })); }, 'More than one rotation is active.'],
  ['no settings row', (t) => { t.settings = []; }, 'There must be exactly one settings row.'],
  ['wrong settings id', (t) => { t.settings[0].id = 'other'; }, 'Settings: "id" is not "singleton".'],
  ['settings missing a field', (t) => { delete (t.settings[0] as Partial<typeof t.settings[0]>).restAlertSound; }, 'Settings: "restAlertSound" is missing.'],
];

it.each(cases)('rejects %s', (_label, mutate, message) => {
  const t = fullTables();
  mutate(t);
  expect(validateTables(t, NOW)).toBe(message);
});

it('names a workout dated before 2000, and accepts one at exactly the boundary', () => {
  const t = fullTables();
  t.sessions[0].name = 'Moved Push';
  t.sessions[0].startedAt = EARLIEST_PLAUSIBLE_TIME - 1;
  expect(validateTables(t, NOW)).toBe(`Workout "Moved Push" on ${date(EARLIEST_PLAUSIBLE_TIME - 1)}: "startedAt" is before 2000.`);
  t.sessions[0].startedAt = EARLIEST_PLAUSIBLE_TIME;
  expect(validateTables(t, NOW)).toBeNull();
});

// Behaviour beyond the table above: what a message says when a row is
// malformed in ways that table doesn't cover.
it.each<[string, (t: BackupTables) => void, string]>([
  ['a workout whose startedAt is unusable, named without a date', (t) => { t.sessions[0].startedAt = NaN; }, 'Workout "Upper A": "startedAt" is not a finite number.'],
  ['a routine item with a field missing, naming the item', (t) => { delete (t.routines[0].items[0] as Partial<typeof t.routines[0]['items'][0]>).exerciseId; }, 'Routine "Upper A": "items[0].exerciseId" is missing.'],
  ['a routine item with an infinite rest', (t) => { t.routines[0].items[0].restSeconds = Infinity; }, 'Routine "Upper A": "items[0].restSeconds" is not a finite number.'],
  ['a rotation listing something that is not an id', (t) => { t.cycles[0].routineIds = [7 as never]; }, 'Rotation "c-main": "routineIds" is not text.'],
  ['muscles that are not a list', (t) => { t.exercises[0].secondaryMuscles = 'glutes' as never; }, 'Exercise "Explosive Box Step-Up": "secondaryMuscles" is not a list.'],
  ['a row that is not an object', (t) => { t.exercises = [null as never]; }, 'Exercise (undefined): "id" is missing.'],
  ['an id that is not text', (t) => { t.bodyweight[0].id = 4 as never; }, 'Bodyweight entry 4: "id" is not text.'],
  ['a bodyweight entry before 2000', (t) => { t.bodyweight[0].date = EARLIEST_PLAUSIBLE_TIME - 1; }, 'Bodyweight entry bw-1: "date" is before 2000.'],
  ['a goal target before 2000', (t) => { t.goals[0].targetDate = EARLIEST_PLAUSIBLE_TIME - 1; }, 'Goal g-1: "targetDate" is before 2000.'],
  ['a last-backup time in the future', (t) => { t.settings[0].lastBackupAt = NOW + 2 * DAY; }, 'Settings: "lastBackupAt" is in the future.'],
  ['two settings rows', (t) => { t.settings.push(settingsRow()); }, 'Settings: "id" is used twice.'],
  ['a duplicate exercise id', (t) => { t.exercises.push(exerciseRow({ id: 'ex-custom' })); }, 'Exercise "ex-custom": "id" is used twice.'],
])('also rejects %s', (_label, mutate, message) => {
  const t = fullTables();
  mutate(t);
  expect(validateTables(t, NOW)).toBe(message);
});

it('reports the first problem: earlier table, then earlier row, then earlier field', () => {
  const t = fullTables();
  t.sets[0].weight = NaN; // a later table
  // Array order, not id or name order: the first row sorts last on both.
  t.exercises.push(exerciseRow({ id: 'ex-a', name: 'Alpha', equipment: 'sled' as never }));
  t.exercises.unshift(exerciseRow({ id: 'ex-z', name: 'Zed', equipment: 'sled' as never, isCustom: 'yes' as never }));
  expect(validateTables(t, NOW)).toBe('Exercise "Zed": "equipment" is not a known value.');
});

it('ignores a field it does not know', () => {
  const t = fullTables();
  (t.sets[0] as unknown as Record<string, unknown>).addedLater = ['tag'];
  expect(validateTables(t, NOW)).toBeNull();
});

it.each<[string, (t: BackupTables) => void, string]>([
  ['a set to a missing exercise', (t) => { t.sets[0].exerciseId = 'gone'; }, `A set in workout "Upper A" on ${date(T0 + 123)} refers to an exercise that isn't there.`],
  ['a set to a missing workout', (t) => { t.sets[0].sessionId = 'gone'; }, "A set (s-1) refers to a workout that isn't there."],
  ['a routine item to a missing exercise', (t) => { t.routines[0].items[0].exerciseId = 'gone'; }, `Routine "Upper A" refers to an exercise that isn't there.`],
  ['a rotation to a missing routine', (t) => { t.cycles[0].routineIds = ['gone']; }, `Rotation "c-main" refers to a routine that isn't there.`],
  ['a goal to a missing exercise', (t) => { t.goals[0].exerciseId = 'gone'; }, "Goal g-1 refers to an exercise that isn't there."],
])('reports %s', (_label, mutate, message) => {
  const t = fullTables();
  mutate(t);
  expect(checkReferences(t)).toBe(message);
});
