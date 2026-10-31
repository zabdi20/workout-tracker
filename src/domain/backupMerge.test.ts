import { addsNothing, planMerge, sameRow } from './backupMerge';
import type { MergePlan, MergeSummary } from './backupMerge';
import { TABLE_NAMES } from './backupFormat';
import type { BackupFile, BackupTables } from './backupFormat';
import {
  DAY, HOUR, MIN, NOW, T0, backupFile, cycleRow, emptyTables, exerciseRow, fullTables,
  routineRow, sessionRow, setRow, settingsRow,
} from './backupTestRows';
import type { Exercise, Goal } from '../db/types';

// ---- Helpers ---------------------------------------------------------------

/** `backupFile`'s default exportedAt. */
const BACKUP_MADE = NOW - DAY;
const BUNDLED: Exercise[] = [
  exerciseRow({ id: 'Side_to_Side_Box_Shuffle', name: 'Side to Side Box Shuffle', measurementType: 'bodyweight_reps', isCustom: false }),
  exerciseRow({ id: 'Barbell_Squat', name: 'Barbell Squat', isCustom: false }),
];

/** Overlays `put` onto `rows` by id: replaced in place, new ones at the end. */
function overlay<T extends { id: string }>(rows: T[], put: T[]): T[] {
  const replacement = new Map(put.map((r) => [r.id, r]));
  const present = new Set(rows.map((r) => r.id));
  return [...rows.map((r) => replacement.get(r.id) ?? r), ...put.filter((r) => !present.has(r.id))];
}

/** What the phone holds once the plan is applied. Written out here, not shared
 *  with the implementation, so a slip in one cannot hide a slip in the other. */
function applyPlan(phone: BackupTables, plan: MergePlan): BackupTables {
  return {
    exercises: overlay(phone.exercises, plan.put.exercises),
    routines: overlay(phone.routines, plan.put.routines),
    cycles: overlay(phone.cycles, plan.put.cycles).filter((c) => !plan.deleteCycleIds.includes(c.id)),
    sessions: overlay(phone.sessions, plan.put.sessions),
    sets: overlay(phone.sets, plan.put.sets),
    bodyweight: overlay(phone.bodyweight, plan.put.bodyweight),
    goals: overlay(phone.goals, plan.put.goals),
    settings: overlay(phone.settings, plan.put.settings),
  };
}

/** A phone that has just opened the app: the bundled library, the empty
 *  rotation Today creates, and the default settings. */
function freshPhone(bundled: Exercise[]): BackupTables {
  return {
    ...emptyTables(),
    exercises: bundled.map((e) => ({ ...e })),
    cycles: [cycleRow({ id: 'c-fresh', isActive: true })],
    settings: [settingsRow({})],
  };
}

/** A backup that holds `tables`, over no rows and the default settings. */
function backupOf(tables: Partial<BackupTables>, exportedAt?: number): BackupFile {
  return backupFile({ ...emptyTables(), settings: [settingsRow({})], ...tables }, exportedAt);
}

function planOf(phone: BackupTables, backup: BackupFile, bundled: Exercise[] = BUNDLED): MergePlan {
  const result = planMerge(phone, backup, bundled);
  if (!result.ok) throw new Error(result.detail);
  return result.plan;
}

const activeIds = (tables: BackupTables) => tables.cycles.filter((c) => c.isActive).map((c) => c.id);

const goalOn = (id: string, exerciseId: string): Goal => ({
  id, type: 'lift_weight_reps', exerciseId, targetValue: 100, targetReps: 5, unit: 'kg', createdAt: T0,
});

const summaryOf = (over: Partial<MergeSummary> = {}): MergeSummary => ({
  workouts: 0, sets: 0, routines: 0, customExercises: 0, libraryEdits: 0,
  matchedExercises: [], rotationReplaced: false,
  settings: { unitPreference: 'lb', defaultRestSeconds: 90, restAlertSound: true },
  ...over,
});

// ---- A full backup on a fresh phone ----------------------------------------

it('adds every row of a full backup to a fresh phone, field for field', () => {
  // Rejects: dropping or reshaping any field on the way through.
  const backup = backupFile({ ...fullTables(), exercises: [...BUNDLED, ...fullTables().exercises] });
  const phone = freshPhone(BUNDLED);
  const result = planMerge(phone, backup, BUNDLED);
  if (!result.ok) throw new Error(result.detail);
  const merged = applyPlan(phone, result.plan);
  for (const name of ['routines', 'sessions', 'sets', 'bodyweight', 'goals'] as const) {
    expect(merged[name]).toEqual(backup.tables[name]);
  }
  expect(merged.cycles).toEqual(backup.tables.cycles); // c-fresh removed, c-main active
  expect(merged.exercises.find((e) => e.id === 'ex-custom')).toEqual(backup.tables.exercises.find((e) => e.id === 'ex-custom'));
  expect(result.plan.summary).toMatchObject({ workouts: 1, sets: 1, routines: 1, customExercises: 1, libraryEdits: 0, rotationReplaced: false, matchedExercises: [] });
});

// ---- The phone's copy wins -------------------------------------------------

it("keeps the phone's copy when both have the same row", () => {
  // Rejects: backup-wins.
  const phone = { ...freshPhone(BUNDLED), sessions: [sessionRow({ id: 'w-1', name: 'Phone name' })] };
  const backup = backupOf({ sessions: [sessionRow({ id: 'w-1', name: 'Backup name' })] });
  const { put, summary } = planOf(phone, backup);
  expect(put.sessions.map((s) => s.id)).not.toContain('w-1');
  expect(put.sessions).toEqual([]);
  expect(summary.workouts).toBe(0);
});

it("keeps the phone's row in every table where both have the id", () => {
  // Rejects: backup-wins on any one table, not only on workouts.
  const phone: BackupTables = {
    ...freshPhone(BUNDLED),
    exercises: [...BUNDLED, exerciseRow({ id: 'ex-1', name: 'Phone name' })],
    routines: [routineRow({ id: 'r-1', name: 'Phone name' })],
    cycles: [
      cycleRow({ id: 'c-spare', name: 'Phone spare' }),
      cycleRow({ id: 'c-main', routineIds: ['r-1'], currentIndex: 1, isActive: true }),
    ],
    sessions: [sessionRow({ id: 'w-1', name: 'Phone name' })],
    sets: [setRow({ id: 's-1', sessionId: 'w-1', exerciseId: 'ex-1', weight: 100 })],
    bodyweight: [{ id: 'bw-1', date: T0, weight: 80, unit: 'kg' }],
    goals: [goalOn('g-1', 'ex-1')],
    settings: [settingsRow({ lastBackupAt: BACKUP_MADE })], // already restored once: settings match
  };
  const backup = backupOf({
    exercises: [exerciseRow({ id: 'ex-1', name: 'Backup name' })],
    routines: [routineRow({ id: 'r-1', name: 'Backup name' })],
    cycles: [
      cycleRow({ id: 'c-spare', name: 'Backup spare' }),
      cycleRow({ id: 'c-main', routineIds: ['r-1'], currentIndex: 0, isActive: true }),
    ],
    sessions: [sessionRow({ id: 'w-1', name: 'Backup name' })],
    sets: [setRow({ id: 's-1', sessionId: 'w-1', exerciseId: 'ex-1', weight: 105 })],
    bodyweight: [{ id: 'bw-1', date: T0, weight: 81, unit: 'kg' }],
    goals: [{ ...goalOn('g-1', 'ex-1'), targetValue: 110 }],
  });
  const { put, deleteCycleIds, summary } = planOf(phone, backup);
  for (const name of TABLE_NAMES) expect(put[name]).toEqual([]);
  expect(deleteCycleIds).toEqual([]);
  expect(addsNothing(summary)).toBe(true);
});

it("keeps the rotation when both sides have the same one", () => {
  // Rejects: backup-wins on cycles.
  const phone = { ...freshPhone(BUNDLED), cycles: [cycleRow({ id: 'c-main', currentIndex: 1, isActive: true })] };
  const backup = backupOf({ cycles: [cycleRow({ id: 'c-main', currentIndex: 0, isActive: true })] });
  const { put, deleteCycleIds, summary } = planOf(phone, backup);
  expect(put.cycles.map((c) => c.id)).not.toContain('c-main');
  expect(put.cycles).toEqual([]);
  expect(deleteCycleIds).toEqual([]);
  expect(summary.rotationReplaced).toBe(false);
});

// ---- Library exercises -----------------------------------------------------

it("lets the backup's edit replace a library row the phone never touched", () => {
  // Rejects: ignoring "untouched" (a library row could never come back edited).
  const edited = { ...BUNDLED[0], name: 'Lateral Shuffle', measurementType: 'duration' as const };
  const backup = backupOf({ exercises: [edited, BUNDLED[1]] });
  const { put, summary } = planOf(freshPhone(BUNDLED), backup);
  expect(put.exercises).toEqual([edited]);
  expect(summary.libraryEdits).toBe(1);
  expect(summary.customExercises).toBe(0);
});

it('keeps a library row the phone edited', () => {
  // Rejects: backup-wins on bundled rows.
  const phone = freshPhone(BUNDLED);
  phone.exercises[0] = { ...BUNDLED[0], name: 'Lateral Shuffle' };
  const backup = backupOf({ exercises: [{ ...BUNDLED[0], name: 'Shuffle (backup)' }, BUNDLED[1]] });
  const { put, summary } = planOf(phone, backup);
  expect(put.exercises).toEqual([]);
  expect(summary.libraryEdits).toBe(0);
});

it('judges "untouched" by every field, not the name', () => {
  // Rejects: a name-only comparison.
  const phone = freshPhone(BUNDLED);
  phone.exercises[0] = { ...BUNDLED[0], measurementType: 'duration' }; // name unchanged
  const backup = backupOf({ exercises: [{ ...BUNDLED[0], name: 'Lateral Shuffle' }, BUNDLED[1]] });
  const { put, summary } = planOf(phone, backup);
  expect(put.exercises).toEqual([]);
  expect(summary.libraryEdits).toBe(0);
});

it('treats an absent field and an undefined one as equal', () => {
  // Rejects: strict key comparison. The bundled entry has no `instructions` key.
  expect('instructions' in BUNDLED[0]).toBe(false);
  const phone = freshPhone(BUNDLED);
  phone.exercises[0] = { ...BUNDLED[0], instructions: undefined };
  expect('instructions' in phone.exercises[0]).toBe(true);
  const edited = { ...BUNDLED[0], name: 'Lateral Shuffle' };
  const { put, summary } = planOf(phone, backupOf({ exercises: [edited, BUNDLED[1]] }));
  expect(put.exercises).toEqual([edited]);
  expect(summary.libraryEdits).toBe(1);
});

it("keeps a custom exercise the phone has under the same id", () => {
  // Rejects: replacing any phone exercise that differs, not only untouched library rows.
  const phone = { ...freshPhone(BUNDLED), exercises: [...BUNDLED, exerciseRow({ id: 'ex-1', name: 'Phone name' })] };
  const backup = backupOf({ exercises: [exerciseRow({ id: 'ex-1', name: 'Backup name' })] });
  const { put, summary } = planOf(phone, backup);
  expect(put.exercises).toEqual([]);
  expect(addsNothing(summary)).toBe(true);
});

// ---- A recreated custom exercise -------------------------------------------

/** The phone recreated "Explosive Box Step-Up" under a new id; the backup has
 *  it as `old-id`, spelt differently, with a routine item, a set and a goal. */
function recreated(backupType: Exercise['measurementType']) {
  const phone: BackupTables = {
    ...freshPhone(BUNDLED),
    exercises: [...BUNDLED, exerciseRow({ id: 'new-id', name: 'Explosive Box Step-Up', measurementType: 'bodyweight_reps' })],
    sessions: [sessionRow({ id: 'p-w' })],
    sets: [setRow({ id: 'p-set', sessionId: 'p-w', exerciseId: 'new-id' })],
  };
  const backup = backupOf({
    exercises: [exerciseRow({ id: 'old-id', name: '  explosive box step-UP ', measurementType: backupType })],
    routines: [routineRow({ id: 'r-b', items: [{ id: 'i-b', exerciseId: 'old-id', order: 0, supersetGroup: null }] })],
    sessions: [sessionRow({ id: 'w-b' })],
    sets: [setRow({ id: 's-b', sessionId: 'w-b', exerciseId: 'old-id' })],
    goals: [goalOn('g-b', 'old-id')],
  });
  return { phone, backup };
}

it('matches a recreated custom exercise by name and type, ignoring case and spaces', () => {
  // Rejects: matching by id only, and rewriting phone rows.
  const { phone, backup } = recreated('bodyweight_reps');
  const { put, summary } = planOf(phone, backup);
  expect(put.exercises).toEqual([]); // neither old-id nor new-id
  expect(put.sets.map((s) => s.id)).toEqual(['s-b']); // not p-set
  expect(put.sets.map((s) => s.exerciseId)).toEqual(['new-id']);
  expect(put.sets[0]).toEqual({ ...backup.tables.sets[0], exerciseId: 'new-id' });
  expect(put.routines.map((r) => r.items.map((i) => i.exerciseId))).toEqual([['new-id']]);
  expect(put.goals.map((g) => g.exerciseId)).toEqual(['new-id']);
  expect(summary.matchedExercises).toEqual(['Explosive Box Step-Up']);
  expect(summary.customExercises).toBe(0);
});

it('keeps same-named custom exercises of different types apart', () => {
  // Rejects: ignoring the measurement type.
  const { phone, backup } = recreated('weight_reps');
  const { put, summary } = planOf(phone, backup);
  expect(put.exercises).toEqual(backup.tables.exercises); // old-id is added
  expect(put.sets.map((s) => s.exerciseId)).toEqual(['old-id']);
  expect(put.routines.map((r) => r.items.map((i) => i.exerciseId))).toEqual([['old-id']]);
  expect(put.goals.map((g) => g.exerciseId)).toEqual(['old-id']);
  expect(summary.matchedExercises).toEqual([]);
  expect(summary.customExercises).toBe(1);
});

it('never name-matches a bundled row', () => {
  // Rejects: matching every exercise, not only custom ones.
  const phone = { ...freshPhone(BUNDLED), exercises: [...BUNDLED, exerciseRow({ id: 'my-box-jump', name: 'Box Jump' })] };
  const newer = exerciseRow({ id: 'Box_Jump_New', name: 'Box Jump', isCustom: false });
  const { put, summary } = planOf(phone, backupOf({ exercises: [newer] }));
  expect(put.exercises).toEqual([newer]);
  expect(summary.matchedExercises).toEqual([]);
  expect(summary.customExercises).toBe(0); // a newer library row is not a custom exercise
  expect(summary.libraryEdits).toBe(0);
});

it('never name-matches a custom exercise onto a bundled row on the phone', () => {
  // Rejects: looking for matches among all of the phone's exercises, not its custom ones.
  const mine = exerciseRow({ id: 'my-squat', name: 'barbell squat' }); // same name and type as Barbell_Squat
  const backup = backupOf({
    exercises: [mine],
    sessions: [sessionRow({ id: 'w-b' })],
    sets: [setRow({ id: 's-b', sessionId: 'w-b', exerciseId: 'my-squat' })],
  });
  const { put, summary } = planOf(freshPhone(BUNDLED), backup);
  expect(put.exercises).toEqual([mine]);
  expect(put.sets.map((s) => s.exerciseId)).toEqual(['my-squat']);
  expect(summary.matchedExercises).toEqual([]);
  expect(summary.customExercises).toBe(1);
});

it('prefers an unarchived match, then the lowest id', () => {
  // Rejects: first-found, last-found, lowest id alone, and ignoring "archived".
  // Inserted c, a (archived), b, d: the answer, b, is not first, last, or
  // alphabetically first.
  const phone = {
    ...freshPhone(BUNDLED),
    exercises: [
      ...BUNDLED,
      exerciseRow({ id: 'c', name: 'Step-Up' }),
      exerciseRow({ id: 'a', name: 'step-up', isArchived: true }),
      exerciseRow({ id: 'b', name: 'STEP-UP' }),
      exerciseRow({ id: 'd', name: 'Step-up' }),
    ],
  };
  const backup = backupOf({
    exercises: [exerciseRow({ id: 'old', name: 'Step-Up' })],
    sessions: [sessionRow({ id: 'w-b' })],
    sets: [setRow({ id: 's-b', sessionId: 'w-b', exerciseId: 'old' })],
  });
  const { put, summary } = planOf(phone, backup);
  expect(put.sets.map((s) => s.exerciseId)).toEqual(['b']);
  expect(summary.matchedExercises).toEqual(['STEP-UP']); // the phone row's own name
});

// ---- The rotation ----------------------------------------------------------

it('removes the empty rotation a fresh phone starts with', () => {
  // Rejects: leaving the empty cycle behind, and treating it as one to set aside.
  const phone = freshPhone(BUNDLED);
  const backup = backupOf({
    cycles: [cycleRow({ id: 'c-spare' }), cycleRow({ id: 'c-main', isActive: true })],
  });
  const plan = planOf(phone, backup);
  expect(plan.deleteCycleIds).toEqual(['c-fresh']);
  expect(plan.put.cycles).toContainEqual(cycleRow({ id: 'c-main', isActive: true }));
  expect(plan.summary.rotationReplaced).toBe(false);
  expect(activeIds(applyPlan(phone, plan))).toEqual(['c-main']);
});

it('sets aside a rotation built on the new phone', () => {
  // Rejects: keep-phone, and deleting a cycle that has routines in it.
  const phone: BackupTables = {
    ...freshPhone(BUNDLED),
    routines: [routineRow({ id: 'r-phone' })],
    cycles: [
      cycleRow({ id: 'c-old', routineIds: ['r-phone'] }),
      cycleRow({ id: 'c-phone', routineIds: ['r-phone'], currentIndex: 2, isActive: true }),
    ],
  };
  const backup = backupOf({
    cycles: [cycleRow({ id: 'c-spare' }), cycleRow({ id: 'c-main', isActive: true })],
  });
  const plan = planOf(phone, backup);
  expect(plan.put.cycles).toHaveLength(3);
  expect(plan.put.cycles).toContainEqual(cycleRow({ id: 'c-phone', routineIds: ['r-phone'], currentIndex: 2, isActive: false }));
  expect(plan.put.cycles).toContainEqual(cycleRow({ id: 'c-main', isActive: true }));
  expect(plan.put.cycles).toContainEqual(cycleRow({ id: 'c-spare' }));
  expect(plan.deleteCycleIds).toEqual([]);
  expect(plan.summary.rotationReplaced).toBe(true);
  const merged = applyPlan(phone, plan);
  expect(activeIds(merged)).toEqual(['c-main']);
  expect(merged.cycles.map((c) => c.id).sort()).toEqual(['c-main', 'c-old', 'c-phone', 'c-spare']);
});

it("leaves the phone's rotation active when the backup has none", () => {
  // Rejects: promoting or deleting anything when there is no backup rotation.
  const phone = freshPhone(BUNDLED);
  const backup = backupOf({ cycles: [cycleRow({ id: 'c-spare' })] });
  const plan = planOf(phone, backup);
  expect(plan.put.cycles).toEqual([cycleRow({ id: 'c-spare' })]); // added as it is, inactive
  expect(plan.deleteCycleIds).toEqual([]);
  expect(plan.summary.rotationReplaced).toBe(false);
  expect(activeIds(applyPlan(phone, plan))).toEqual(['c-fresh']);
});

it("keeps the phone's copy of the backup's rotation when it was set aside there", () => {
  // Rejects: the backup's row overwriting a phone row just to make it active
  // (the phone's copy has moved on to index 5).
  const phone: BackupTables = {
    ...freshPhone(BUNDLED),
    routines: [routineRow({ id: 'r-main' })],
    cycles: [
      cycleRow({ id: 'c-main', routineIds: ['r-main'], currentIndex: 5 }),
      cycleRow({ id: 'c-later', routineIds: ['r-main'], isActive: true }),
    ],
  };
  const backup = backupOf({
    routines: [routineRow({ id: 'r-main' })],
    cycles: [cycleRow({ id: 'c-main', routineIds: ['r-main'], currentIndex: 2, isActive: true })],
  });
  const plan = planOf(phone, backup);
  const merged = applyPlan(phone, plan);
  expect(activeIds(merged)).toEqual(['c-main']);
  expect(merged.cycles.find((c) => c.id === 'c-main')).toEqual(
    cycleRow({ id: 'c-main', routineIds: ['r-main'], currentIndex: 5, isActive: true }),
  );
  expect(plan.summary.rotationReplaced).toBe(true); // c-later had routines
});

// ---- A workout that was moved ----------------------------------------------

it('shifts a set into a workout that was moved since the backup', () => {
  // Rejects: keeping the old time, and shifting sets of workouts the phone lacks.
  const phone: BackupTables = {
    ...freshPhone(BUNDLED),
    sessions: [sessionRow({ id: 'w-1', startedAt: T0 + DAY, endedAt: T0 + DAY + HOUR })],
  };
  const backup = backupOf({
    exercises: BUNDLED,
    sessions: [sessionRow({ id: 'w-1', startedAt: T0 }), sessionRow({ id: 'w-2', startedAt: T0 + 3 * DAY })],
    sets: [
      setRow({ id: 's-2', sessionId: 'w-1', exerciseId: 'Barbell_Squat', completedAt: T0 + 5 * MIN }),
      setRow({ id: 's-3', sessionId: 'w-2', exerciseId: 'Barbell_Squat', completedAt: T0 + 3 * DAY + 7 * MIN }),
    ],
  });
  const { put, summary } = planOf(phone, backup);
  const completedAt = (id: string) => put.sets.find((s) => s.id === id)?.completedAt;
  expect(completedAt('s-2')).toBe(T0 + DAY + 5 * MIN);
  expect(completedAt('s-3')).toBe(T0 + 3 * DAY + 7 * MIN);
  expect(summary).toMatchObject({ workouts: 1, sets: 2 });
});

// ---- Settings --------------------------------------------------------------

it("takes three settings from the backup and keeps the phone's library version", () => {
  // Rejects: copying the backup's row whole, or the backup's lastBackupAt.
  const phone = { ...freshPhone(BUNDLED), settings: [settingsRow({ libraryVersion: 3, lastBackupAt: undefined })] };
  const backup = backupOf({
    settings: [settingsRow({
      unitPreference: 'kg', defaultRestSeconds: 150, restAlertSound: false, libraryVersion: 1, lastBackupAt: T0 + 1,
    })],
  });
  const { put, summary } = planOf(phone, backup);
  expect(put.settings).toEqual([{
    id: 'singleton',
    unitPreference: 'kg',
    defaultRestSeconds: 150,
    restAlertSound: false,
    libraryVersion: 3,
    lastBackupAt: backup.exportedAt,
  }]);
  expect(summary.settings).toEqual({ unitPreference: 'kg', defaultRestSeconds: 150, restAlertSound: false });
});

it('keeps the later of the two backup dates', () => {
  // Rejects: always taking the file's date (or the earlier of the two).
  const exportedAt = T0 + 20 * DAY;
  const phone = { ...freshPhone(BUNDLED), settings: [settingsRow({ lastBackupAt: exportedAt + 5 })] };
  const backup = backupOf({ settings: [settingsRow({ unitPreference: 'kg' })] }, exportedAt);
  const { put } = planOf(phone, backup);
  expect(put.settings).toHaveLength(1);
  expect(put.settings[0].lastBackupAt).toBe(exportedAt + 5);
});

// ---- Idempotence, refusal, references --------------------------------------

it('adds nothing when the same file is merged twice', () => {
  // Rejects: a merge that is not keyed by id, or that keeps re-putting what it set.
  const phone: BackupTables = {
    ...freshPhone(BUNDLED),
    routines: [routineRow({ id: 'r-phone' })],
    cycles: [cycleRow({ id: 'c-phone', routineIds: ['r-phone'], isActive: true })], // set aside by the first merge
  };
  const edited = { ...BUNDLED[0], name: 'Lateral Shuffle' };
  const backup = backupFile({ ...fullTables(), exercises: [edited, BUNDLED[1], ...fullTables().exercises] });

  const first = planOf(phone, backup);
  expect(addsNothing(first.summary)).toBe(false); // the first merge really adds
  expect(first.summary).toMatchObject({ libraryEdits: 1, rotationReplaced: true });
  const afterFirst = applyPlan(phone, first);

  const second = planOf(afterFirst, backup);
  expect(addsNothing(second.summary)).toBe(true);
  for (const name of TABLE_NAMES) expect(second.put[name]).toEqual([]);
  expect(second.deleteCycleIds).toEqual([]);
});

it('refuses while a workout is in progress on the phone', () => {
  // Rejects: not checking, and checking the backup's workouts instead of the phone's.
  const phone = {
    ...freshPhone(BUNDLED),
    sessions: [sessionRow({ id: 'w-live', status: 'in_progress', endedAt: undefined })],
  };
  const backup = backupOf({ sessions: [sessionRow({ id: 'w-1' })] });
  expect(planMerge(phone, backup, BUNDLED)).toEqual({
    ok: false,
    reason: 'in-progress',
    detail: 'Finish or discard your workout in progress before restoring.',
  });
});

it("does not refuse for the backup's own unfinished workout", () => {
  // Rejects: refusing when EITHER side has a workout in progress (user decision 13:
  // it restores as an unfinished workout).
  const live = sessionRow({ id: 'w-live', status: 'in_progress', endedAt: undefined });
  const result = planMerge(freshPhone(BUNDLED), backupOf({ sessions: [live] }), BUNDLED);
  if (!result.ok) throw new Error(result.detail);
  expect(result.plan.put.sessions).toEqual([live]);
});

it('checks references over the merged result', () => {
  // Rejects: checking the file alone (a), and checking nothing (b).
  const phone = { ...freshPhone(BUNDLED), exercises: [...BUNDLED, exerciseRow({ id: 'phone-only' })] };

  const onPhoneOnly = backupOf({
    sessions: [sessionRow({ id: 'w-b' })],
    sets: [setRow({ id: 's-b', sessionId: 'w-b', exerciseId: 'phone-only' })],
  });
  const ok = planMerge(phone, onPhoneOnly, BUNDLED);
  expect(ok.ok).toBe(true);

  const nowhere = backupOf({
    sessions: [sessionRow({ id: 'w-b' })],
    sets: [setRow({ id: 's-b', sessionId: 'w-b', exerciseId: 'nowhere' })],
  });
  expect(planMerge(phone, nowhere, BUNDLED)).toEqual({
    ok: false,
    reason: 'damaged',
    detail: `A set in workout "w-b" on ${new Date(T0).toLocaleDateString()} refers to an exercise that isn't there.`,
  });
});

it('leaves the rows it was given as they were', () => {
  // Rejects: editing the phone's or the file's rows in place (flipping isActive,
  // rewriting an exerciseId or a completedAt on the original object).
  const phone: BackupTables = {
    ...freshPhone(BUNDLED),
    exercises: [...BUNDLED, exerciseRow({ id: 'new-id', name: 'Step-Up' })],
    routines: [routineRow({ id: 'r-phone' })],
    cycles: [cycleRow({ id: 'c-phone', routineIds: ['r-phone'], isActive: true })],
    sessions: [sessionRow({ id: 'w-1', startedAt: T0 + DAY })],
  };
  const backup = backupOf({
    exercises: [exerciseRow({ id: 'old-id', name: 'step-up' })],
    routines: [routineRow({ id: 'r-b', items: [{ id: 'i-b', exerciseId: 'old-id', order: 0, supersetGroup: null }] })],
    cycles: [cycleRow({ id: 'c-main', isActive: true })],
    sessions: [sessionRow({ id: 'w-1', startedAt: T0 })],
    sets: [setRow({ id: 's-b', sessionId: 'w-1', exerciseId: 'old-id', completedAt: T0 + 5 * MIN })],
    goals: [goalOn('g-b', 'old-id')],
    settings: [settingsRow({ unitPreference: 'kg' })],
  });
  const phoneBefore = structuredClone(phone);
  const backupBefore = structuredClone(backup);
  const plan = planOf(phone, backup);
  expect(plan.put.sets[0].exerciseId).toBe('new-id'); // the scenario really did rewrite and shift
  expect(plan.put.sets[0].completedAt).toBe(T0 + DAY + 5 * MIN);
  expect(plan.summary.rotationReplaced).toBe(true);
  expect(phone).toStrictEqual(phoneBefore);
  expect(backup).toStrictEqual(backupBefore);
});

// ---- sameRow and addsNothing -----------------------------------------------

describe('sameRow', () => {
  it('ignores key order, at every depth', () => {
    expect(sameRow(
      { id: 'a', items: [{ x: 1, y: 2 }], tags: ['p', 'q'] },
      { tags: ['p', 'q'], items: [{ y: 2, x: 1 }], id: 'a' },
    )).toBe(true);
  });

  it('treats an absent key and an undefined one as equal, whichever side has it', () => {
    expect(sameRow({ id: 'a' }, { id: 'a', note: undefined })).toBe(true);
    expect(sameRow({ id: 'a', note: undefined }, { id: 'a' })).toBe(true);
    expect(sameRow({ id: 'a', inner: { note: undefined } }, { id: 'a', inner: {} })).toBe(true);
  });

  it('tells apart a changed value, a null, a missing value and a different list', () => {
    expect(sameRow({ id: 'a', n: 1 }, { id: 'a', n: 2 })).toBe(false);
    expect(sameRow({ id: 'a', n: null }, { id: 'a' })).toBe(false);
    expect(sameRow({ id: 'a', n: 0 }, { id: 'a' })).toBe(false);
    expect(sameRow({ id: 'a', n: '' }, { id: 'a', n: undefined })).toBe(false);
    expect(sameRow({ list: ['p', 'q'] }, { list: ['q', 'p'] })).toBe(false);
    expect(sameRow({ list: ['p'] }, { list: ['p', 'q'] })).toBe(false);
    expect(sameRow({ id: 'a', inner: { x: 1 } }, { id: 'a', inner: { x: 2 } })).toBe(false);
  });
});

describe('addsNothing', () => {
  it('is true for an empty summary', () => {
    expect(addsNothing(summaryOf())).toBe(true);
  });

  it.each<[string, Partial<MergeSummary>]>([
    ['workouts', { workouts: 1 }],
    ['sets', { sets: 1 }],
    ['routines', { routines: 1 }],
    ['custom exercises', { customExercises: 1 }],
    ['library edits', { libraryEdits: 1 }],
    ['a matched exercise', { matchedExercises: ['Step-Up'] }],
    ['a replaced rotation', { rotationReplaced: true }],
  ])('is false when there are %s', (_label, over) => {
    expect(addsNothing(summaryOf(over))).toBe(false);
  });
});
