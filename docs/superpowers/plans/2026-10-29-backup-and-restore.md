# Backup and Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save every row of the app's data to a JSON file in iCloud Drive through the share sheet, restore it by an all-or-nothing merge behind a format-version gate, remind the user after 14 days, prompt on storage-full, and prove the round trip end to end in WebKit.

**Architecture:** The file format, validation and the merge are pure functions in `src/domain/` (`backupFormat.ts`, `backupValidate.ts`, `backupMerge.ts`, `backupReminder.ts`). `src/db/backup.ts` reads a snapshot in one read-only transaction and applies a merge in one read-write transaction across all eight tables, re-planning from fresh reads. The UI adds a share-sheet `BackupButton` used in three places, a `WriteErrorAlert` that turns any quota failure into the storage-full prompt, a Settings screen behind a header gear with the restore flow, and a reminder on Today. One Playwright test in WebKit restores into a fresh context and compares raw IndexedDB dumps.

**Tech Stack:** React 19, TypeScript 7, Dexie 4.4, react-router-dom 7.18, Vitest 4 + jsdom 30, @testing-library/react 16 + user-event 14, and new: `@playwright/test` (WebKit only).

**Spec:** `docs/superpowers/specs/2026-10-20-backup-and-restore-design.md`. Read it before your task. Every rule marked **(my call)** there is binding here. The on-device evidence is `docs/superpowers/spikes/2026-10-20-backup-file-transfer.md`.

## Global Constraints

- **Shell:** Git Bash, not PowerShell. If tools are missing: `export PATH="/usr/bin:/bin:/mingw64/bin:/c/Program Files/nodejs:/c/Program Files/GitHub CLI:$PATH"`.
- **Focused test command:** `npx vitest run <path>`. **Full suite:** `npx vitest run --fileParallelism=false` (parallel runs are flaky here). Baseline before this plan: **38 files / 552 tests**. Roughly double means a worktree under `.claude/` is being collected — stop.
- **`npx tsc --noEmit` must exit 0 before every commit.** Vitest transpiles without typechecking.
- **Vitest globals are on.** Never import `describe`, `it`, `expect`, `beforeEach`, `afterEach` or `vi`.
- **Every test must be seen failing before its implementation exists**, and every absence assertion ("records nothing", "leaves unchanged", "is not added") must be **broken on purpose**: apply the wrong implementation the task names, watch the test fail, restore. Test output must be pristine.
- **Tests run pinned to `America/Chicago`** (`vite.config.ts`). Anything with local dates (file names, "days ago", `toLocaleString`) depends on it.
- **`src/domain/` is pure and I/O-free.** Type-only imports from `src/db/types` are fine, and so is `src/domain/labels`. Nothing from `src/db/` at runtime.
- **Never `.where()` on a boolean or nullable field.** Backup code reads whole tables with `toArray()`.
- **A `useLiveQuery` querier may not open a readwrite transaction**, and **each new screen has exactly one querier.**
- **`run(...)` from `src/ui/useWriteError.ts` never rejects** and resolves `true`/`false`. A failed write must never discard what the user typed.
- **Never pass `id` inside a Dexie `update()` payload.** Whole-row writes use `put`/`bulkPut`.
- **Weight is never converted.** No backup or restore code touches a weight's number or unit.
- **Number inputs inside a `<form>` need `noValidate`.**
- **List items are keyed by id, never by index.**
- **Display dates with `new Date(ms).toLocaleString()`** (or `toLocaleDateString()`); tests compute the expected string the same way.
- **No CSS.**
- **Ordering fixtures must not sort themselves.** Wherever a test asserts an order or a choice among candidates, the expected answer differs from alphabetical, insertion, chronological and id order.
- **`toHaveTextContent(string)` is a substring match.** Anchor with a regex where a longer string would also match.
- **After an action, re-query the live document** (`screen.…`), never a node captured before it.
- **Every spy and every stubbed global is restored in `afterEach`** (`vi.restoreAllMocks()`, plus deleting stubbed `navigator` and `URL` properties), so a stub cannot leak into the next test.
- **End every commit message with:** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

Failure modes the spec implies that a person will hit and that no single rule names, most likely first. Each has a test in the task that owns it.

1. **A double-tap on Back up now** must not open two share sheets. A second `share()` while one is open rejects on iOS. → Task 5, `cannot start a second backup while one is in flight`.
2. **A double-tap on Restore** must not error or double anything. The second apply finds everything present. → Task 4, `adds nothing when the same file is applied twice`; Task 8, `disables Restore while it runs`.
3. **A phone whose settings row predates a field** (a row written before `restAlertSound` existed) must still produce a backup that validates. → Task 4, `fills settings defaults into the snapshot`.
4. **A file missing one table, or whose `tables` isn't an object** (hand-edited, truncated by a sync glitch) must be refused as damaged, not crash. → Task 1, `refuses a file missing a table`.
5. **A backup made late in the evening** must be named with the local date, not the UTC one. → Task 1, `names the file in local time`.

---

## File Structure

| File | Task | Responsibility |
| --- | --- | --- |
| `src/domain/backupFormat.ts` (+ test) | 1 | File envelope, file name, parse and version gate |
| `src/domain/backupValidate.ts` (+ test) | 1 | Row validation, referential checks, `EARLIEST_PLAUSIBLE_TIME` |
| `src/domain/backupTestRows.ts` | 1 | TEST-ONLY row builders shared by the domain tests |
| `src/domain/measurement.ts` (+ test) | 2 | `parseSetFields` drops non-finite numbers |
| `src/db/sessions.ts` (+ test) | 2 | `moveSession` refuses a start before 2000 |
| `src/domain/backupMerge.ts` (+ test) | 3 | The merge plan and its summary |
| `src/db/settings.ts` (+ test) | 4 | `updateSettings`, the first settings writer |
| `src/db/backup.ts` (+ test) | 4 | Snapshot, create, record, preview, apply |
| `scripts/make-backup-fixture-v1.ts` | 4 | Generates the frozen version-1 fixture once |
| `src/db/fixtures/backup-v1.json` | 4 | The frozen version-1 fixture |
| `src/db/backupFixtureV1.test.ts` | 4 | Restores the version-1 fixture, forever |
| `src/pwa/shareFile.ts` | 5 | `canShareFiles`, `shareFile`, `downloadFile` |
| `src/ui/backup/BackupButton.tsx` (+ test) | 5 | Back up now, with every share outcome |
| `src/ui/useWriteError.ts` (+ test) | 6 | Quota failures become `STORAGE_FULL_MESSAGE` |
| `src/ui/WriteErrorAlert.tsx` (+ test) | 6 | Renders a write error; storage-full gets Back up now |
| Every screen that renders a `run` error | 6 | Renders `WriteErrorAlert` instead |
| `src/ui/routines/RoutinesScreen.tsx`, `src/ui/library/CustomExerciseForm.tsx` (+ tests) | 6 | Writes move onto `run(...)` |
| `src/ui/AppLayout.tsx` (+ tests) | 6, 7 | Startup storage-full; the Settings gear |
| `src/ui/settings/SettingsScreen.tsx` (+ test) | 7, 8 | `/settings` |
| `src/ui/settings/RestoreControl.tsx` (+ test) | 8 | Pick, confirm, apply |
| `src/domain/backupReminder.ts` (+ test) | 7, 9 | Days-ago label; when the reminder shows |
| `src/ui/today/TodayScreen.tsx` (+ test) | 6, 9 | Reminder at the top |
| `src/App.tsx`, `src/App.test.tsx` | 7 | `/settings` route |
| `playwright.config.ts`, `e2e/backup-roundtrip.spec.ts` | 10 | The round trip |
| `package.json`, `vite.config.ts`, `tsconfig.json`, `.gitignore`, `.github/workflows/deploy.yml` | 10 | Playwright wiring and the CI gate |

**Order:** 1 → 3 → 4 → 5 → 6 → 7 → 8, with 2 after 1 (it imports `EARLIEST_PLAUSIBLE_TIME`), 9 after 7 (it reuses `daysAgoLabel`), and 10 last. No task links to a route or imports a module a later task creates.

---

### Task 1: Backup file format and validation

**Files:**
- Create: `src/domain/backupFormat.ts`, `src/domain/backupValidate.ts`, `src/domain/backupTestRows.ts`
- Test: `src/domain/backupFormat.test.ts`, `src/domain/backupValidate.test.ts`

**Interfaces:**
- Consumes: types from `src/db/types`; `MUSCLE_GROUPS`, `EQUIPMENT_TYPES` from `src/domain/labels`.
- Produces, in `backupFormat.ts`:
  - `const BACKUP_FORMAT = 'workout-tracker-backup'`, `const BACKUP_FORMAT_VERSION = 1`
  - `const TABLE_NAMES = ['exercises', 'routines', 'cycles', 'sessions', 'sets', 'bodyweight', 'goals', 'settings'] as const`
  - `interface BackupTables { exercises: Exercise[]; routines: Routine[]; cycles: Cycle[]; sessions: Session[]; sets: LoggedSet[]; bodyweight: BodyweightEntry[]; goals: Goal[]; settings: Settings[] }`
  - `interface BackupFile { format: typeof BACKUP_FORMAT; formatVersion: number; exportedAt: number; dbVersion: number; libraryVersion: number; tables: BackupTables }`
  - `buildBackup(tables: BackupTables, meta: { exportedAt: number; dbVersion: number; libraryVersion: number }): BackupFile`
  - `backupFileName(exportedAt: number): string` — `workout-backup-YYYY-MM-DD-HHMM.json`, **local** time, zero-padded
  - `type ParsedBackup = { ok: true; file: BackupFile } | { ok: false; reason: 'newer' | 'not-backup' | 'damaged'; detail: string }`
  - `parseBackup(text: string, now: number): ParsedBackup`
- Produces, in `backupValidate.ts`:
  - `const EARLIEST_PLAUSIBLE_TIME = Date.UTC(2000, 0, 1)`
  - `const SETTINGS_ROW_ID = 'singleton'` (pinned equal to `db.ts`'s `SETTINGS_ID` in Task 4)
  - `validateTables(tables: BackupTables, now: number): string | null` — the first problem, or `null`
  - `checkReferences(tables: BackupTables): string | null`
- Produces, in `backupTestRows.ts` (TEST-ONLY, header comment like `src/testFixtures.ts`; types only, no `db` import):
  - `T0 = Date.UTC(2025, 0, 6, 17, 0)`, `MIN`, `HOUR`, `DAY`, `NOW = T0 + 30 * DAY`
  - `emptyTables(): BackupTables` — every table `[]`
  - `fullTables(): BackupTables` — the rows listed below, valid and referentially intact
  - `backupFile(tables: BackupTables, exportedAt = NOW - DAY): BackupFile`
  - builders, each taking `Partial<Row>` plus the required ids and filling the defaults listed: `exerciseRow({ id, ... })` (name = id, primaryMuscles `['chest']`, secondaryMuscles `[]`, `'barbell'`, `'weight_reps'`, isCustom `true`, isArchived `false`); `routineRow({ id, ... })` (name = id, items `[]`, isArchived `false`, createdAt/updatedAt `T0`); `cycleRow({ id, ... })` (name = id, routineIds `[]`, currentIndex `0`, isActive `false`); `sessionRow({ id, ... })` (routineId `null`, name = id, startedAt `T0`, endedAt `T0 + HOUR`, status `'completed'`); `setRow({ id, sessionId, exerciseId, ... })` (order `0`, `'working'`, unit `'lb'`, weight `100`, reps `5`, completedAt `T0 + MIN`); `settingsRow({...})` (id `'singleton'`, `'lb'`, `90`, restAlertSound `true`, libraryVersion `2`)

**`fullTables()` sets every optional field to a non-default value, with non-round milliseconds**, so a validator that rejects a legal optional field, or a later exporter that drops one, is caught:
- `exercises`: `ex-custom` — name `'Explosive Box Step-Up'`, `'bodyweight_reps'`, primary `['quads']`, secondary `['glutes']`, `'other'`, instructions `'Step up fast'`, defaultIncrement `2.5`, isCustom `true`.
- `routines`: `r-upper` — name `'Upper A'`, notes `'Heavy'`, one item `{ id: 'i1', exerciseId: 'ex-custom', order: 0, supersetGroup: null, restSeconds: 90, targetSets: 3, targetRepMin: 6, targetRepMax: 8 }`, createdAt `T0 + 11`, updatedAt `T0 + MIN + 13`.
- `cycles`: `c-main` — routineIds `['r-upper']`, currentIndex `0`, isActive `true`.
- `sessions`: `w-1` — routineId `'r-upper'`, name `'Upper A'`, startedAt `T0 + 123`, endedAt `T0 + HOUR + 456`, notes `'Good day'`, bodyweightAtTime `80.5`.
- `sets`: `s-1` — `w-1`, `ex-custom`, order `0`, weight `22.5`, unit `'lb'`, reps `8`, durationSeconds `30`, distanceMeters `12.5`, rpe `8.5`, completedAt `T0 + MIN + 789`, notes `'Felt good'`.
- `bodyweight`: `bw-1` — date `T0 + 7`, weight `80.5`, `'kg'`.
- `goals`: `g-1` — `'lift_weight_reps'`, exerciseId `ex-custom`, targetValue `100`, targetReps `5`, `'kg'`, targetDate `T0 + 400 * DAY` (after `NOW` on purpose), createdAt `T0 + 3`, achievedAt `T0 + DAY + 5`.
- `settings`: one `settingsRow({ unitPreference: 'kg', defaultRestSeconds: 120, lastBackupAt: T0 + 17, restAlertSound: false })`.

**Validation rules** (spec "Validation — before anything is written"). Unknown extra fields are ignored and kept.
- **Required and typed, per table** — the `src/db/types.ts` interfaces. Optional fields may be absent or `undefined`, never `null`. The two exceptions are `RoutineItem.supersetGroup` and `Session.routineId`, which may be `null`. Strings are strings; booleans are booleans; arrays are arrays.
- **Enums:** `MuscleGroup` and `Equipment` use the `labels.ts` lists. `MeasurementType`, `WeightUnit`, `SetType`, `SessionStatus` and `GoalType` are each a `Record<Union, true>` declared here, so adding a union member without updating the validator fails `tsc`.
- **Numbers:** every number field is `Number.isFinite`.
- **Timestamps:** `Routine.createdAt/updatedAt`, `Session.startedAt/endedAt`, `LoggedSet.completedAt`, `BodyweightEntry.date`, `Goal.createdAt/achievedAt` and `Settings.lastBackupAt` must be `>= EARLIEST_PLAUSIBLE_TIME` and `<= now + DAY`. `Goal.targetDate` has the lower bound only.
- **Uniqueness and singletons:** ids are unique within each table. There is exactly one settings row, its id is `SETTINGS_ROW_ID`, and its required fields (`unitPreference`, `defaultRestSeconds`, `restAlertSound`) are present. At most one session has status `'in_progress'`. At most one cycle has `isActive: true`.
- **Order of checks**, so the first problem reported is deterministic:
  - tables in `TABLE_NAMES` order;
  - within a table, rows in array order, then that table's table-level checks;
  - within a row, fields in the order `src/db/types.ts` declares them.

**Message format** — exact, because the backup's self-check shows it to the user (Task 5). In every subject, `"<name>"` becomes `(<id>)` when the row's `name` isn't a string:
- Subjects:
  - `Exercise "<name>"`, `Routine "<name>"`, `Rotation "<name>"`;
  - `Workout "<name>" on <toLocaleDateString(startedAt)>`, dropping ` on …` when `startedAt` isn't a finite number;
  - `A set in workout "<name>" on <date>`, from the set's session in the same tables, or `A set (<id>)` when that session is missing;
  - `Bodyweight entry <id>`, `Goal <id>`, `Settings`.
- Field problems: `<subject>: "<field>" is missing.` / `is not a finite number.` / `is not a known value.` / `is not text.` / `is not true or false.` / `is not a list.` / `is before 2000.` / `is in the future.` / `is used twice.` (the field is `id`).
- Table-level problems:
  - `More than one workout is in progress.`
  - `More than one rotation is active.`
  - `There must be exactly one settings row.`
  - `Settings: "id" is not "singleton".`
- References (`checkReferences`):
  - `<set subject> refers to an exercise that isn't there.`
  - `A set (<id>) refers to a workout that isn't there.`
  - `Routine "<name>" refers to an exercise that isn't there.`
  - `Rotation "<name>" refers to a routine that isn't there.`
  - `Goal <id> refers to an exercise that isn't there.`

**`parseBackup` steps, in order**, each failure returning its result:
1. `JSON.parse`. A failure → `not-backup`, `The file isn't valid JSON.`
2. Not an object, or `format !== BACKUP_FORMAT` → `not-backup`, `The file isn't a workout backup.`
3. `formatVersion` not an integer ≥ 1 → `damaged`, `"formatVersion" is not a whole number.`
4. `formatVersion > BACKUP_FORMAT_VERSION` → `newer`, `` `It was made by format version ${v}; this app reads up to ${BACKUP_FORMAT_VERSION}.` ``
5. Upgrade in memory, one step at a time, through `const UPGRADES: Record<number, (raw: unknown) => unknown> = {}` (empty: version 1 is the first).
6. `tables` not an object, or any `TABLE_NAMES` entry not an array → `damaged`, `` `The "${name}" table is missing.` `` (the first missing one, in `TABLE_NAMES` order).
7. `exportedAt` not a plausible timestamp (same bounds) → `damaged`, `"exportedAt" is not a plausible time.`
8. `validateTables(tables, now)` → `damaged` with its message. **References are not checked here**: they are checked after the merge (Task 3).

- [ ] **Step 1: Write the failing tests**

`src/domain/backupFormat.test.ts`:

```ts
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION, backupFileName, buildBackup, parseBackup } from './backupFormat';
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

it('does not check references, which are checked after the merge', () => {
  const file = backupFile(fullTables());
  file.tables.sets[0].exerciseId = 'only-on-the-phone';
  expect(parseBackup(JSON.stringify(file), NOW).ok).toBe(true);
});
```

`src/domain/backupValidate.test.ts`. Each `it.each` row applies **one** mutation to `fullTables()` and expects the exact message. The clean fixture passing is the over-strictness guard:

```ts
import { checkReferences, EARLIEST_PLAUSIBLE_TIME, validateTables } from './backupValidate';
import { DAY, NOW, T0, cycleRow, fullTables, sessionRow } from './backupTestRows';
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
```

`c-main` has no explicit name in `fullTables()`, so `cycleRow`'s default (name = id) applies, which is what the rotation message expects.

- [ ] **Step 2: Verify they fail** — `npx vitest run src/domain/backupFormat.test.ts src/domain/backupValidate.test.ts` fails: no modules.

- [ ] **Step 3: Implement** the three files to the interfaces and rules above, returning the first problem in the order of checks.

- [ ] **Step 4: Verify** — the focused run passes, and `npx tsc --noEmit` exits 0.

- [ ] **Step 5: Mandated breaks.** One at a time, then restore each:
  - make `backupFileName` use `toISOString` → `names the file in local time` fails;
  - drop the goal `targetDate` exception → `accepts the two nullable fields…` fails;
  - use `<=` for the 2000 bound → the boundary test fails.

- [ ] **Step 6: Commit** — `feat: add the backup file format and its validator`

---

### Task 2: Close the two paths that write unrestorable data

**Files:**
- Modify: `src/domain/measurement.ts` (`parseSetFields`), `src/db/sessions.ts` (`moveSession`)
- Test: `src/domain/measurement.test.ts`, `src/db/sessions.test.ts`

**Interfaces:**
- Consumes: `EARLIEST_PLAUSIBLE_TIME` (Task 1).
- Produces: no new names. `parseSetFields` drops any non-finite number exactly as it drops `NaN`. `moveSession` throws `new Error('A workout cannot be moved before 2000')` when `newStartedAt < EARLIEST_PLAUSIBLE_TIME`, before opening its transaction.

- [ ] **Step 1: Write the failing tests**

In `src/domain/measurement.test.ts`, inside the existing `describe('parseSetFields', …)` block, which already defines `const fields = measurementFields('weight_reps')`:

```ts
it.each(['1e999', 'Infinity', '-Infinity'])('drops %s as it drops NaN', (text) => {
  // Infinity survives an isNaN check, and JSON.stringify writes it as null,
  // which the backup validator then refuses: one typo would make every
  // backup unrestorable.
  expect(parseSetFields(fields, (p) => (p === 'weight' ? text : '8'))).toEqual({ reps: 8 });
});
```

In `src/db/sessions.test.ts`, beside the existing `moveSession` tests (reuse `seedWorkout`, `T`, `MIN` from `src/testFixtures`):

```ts
it('refuses to move a workout before 2000, leaving it and its sets where they were', async () => {
  const bench = await seedExercise();
  const w = await seedWorkout({ startedAt: T, sets: [{ exerciseId: bench.id, weight: 100, reps: 5, completedAt: T + MIN }] });
  await expect(moveSession(w.id, Date.UTC(1999, 11, 31, 12))).rejects.toThrow('A workout cannot be moved before 2000');
  expect((await db.sessions.get(w.id))?.startedAt).toBe(T);
  expect((await db.sets.where('sessionId').equals(w.id).toArray()).map((s) => s.completedAt)).toEqual([T + MIN]);
});

it('allows a move to exactly the start of 2000', async () => {
  const w = await seedWorkout({ startedAt: T });
  await moveSession(w.id, EARLIEST_PLAUSIBLE_TIME);
  expect((await db.sessions.get(w.id))?.startedAt).toBe(EARLIEST_PLAUSIBLE_TIME);
});
```

- [ ] **Step 2: Verify they fail** — the focused runs fail: `1e999` parses to `Infinity`, and the 1999 move succeeds.

- [ ] **Step 3: Implement** both guards.

- [ ] **Step 4: Verify** — `npx vitest run src/domain/measurement.test.ts src/db/sessions.test.ts src/ui/history src/ui/session` passes, since both edit surfaces share `parseSetFields`, and `npx tsc --noEmit` exits 0.

- [ ] **Step 5: Commit** — `fix: never write a non-finite set value or a workout dated before 2000`

---

### Task 3: The merge plan

**Files:**
- Create: `src/domain/backupMerge.ts`
- Test: `src/domain/backupMerge.test.ts`

**Interfaces:**
- Consumes: Task 1 `BackupTables`, `BackupFile`, `checkReferences`, the test rows.
- Produces:
  - `interface MergeSummary { workouts: number; sets: number; routines: number; customExercises: number; libraryEdits: number; matchedExercises: string[]; rotationReplaced: boolean; settings: Pick<Settings, 'unitPreference' | 'defaultRestSeconds' | 'restAlertSound'> }`
  - `interface MergePlan { put: BackupTables; deleteCycleIds: string[]; summary: MergeSummary }` — `put` holds every row to write, added or replaced, per table
  - `type MergeResult = { ok: true; plan: MergePlan } | { ok: false; reason: 'in-progress' | 'damaged'; detail: string }`
  - `planMerge(phone: BackupTables, backup: BackupFile, bundled: Exercise[]): MergeResult` — **precondition:** `phone.settings` holds exactly one row with defaults already filled (Task 4's snapshot guarantees it)
  - `sameRow(a: unknown, b: unknown): boolean` — deep equality, ignoring key order, with an absent key equal to an `undefined` one
  - `addsNothing(summary: MergeSummary): boolean` — every count `0`, no matches, `rotationReplaced` false

**The rules are the spec's "The merge rules" section, in this order:**
1. **Refuse an in-progress phone.** If any phone session is `'in_progress'` → `{ ok: false, reason: 'in-progress', detail: 'Finish or discard your workout in progress before restoring.' }`.
2. **Exercises.** For each backup exercise, by id:
   - **On the phone:** replaced only if the phone row is an untouched bundled row (`sameRow` with this build's bundled entry) and differs from the backup's row. Each replacement counts `libraryEdits`.
   - **Absent, and custom:** look for a match among phone custom rows — `name.trim().toLowerCase()` equal and `measurementType` equal. Prefer unarchived, then the lowest id. A match maps the backup id to the phone id and pushes the **phone row's** name onto `matchedExercises`. With no match, the row is added and counts `customExercises`.
   - **Absent, and bundled** (a newer library): added, never name-matched, not counted.
3. **Rewrite references.** Backup sets, routine items and goals pointing at a matched id are rewritten to the phone id. Phone rows are never rewritten.
4. **Routines, sessions, sets, bodyweight, goals:** each added when its id is absent, counting `routines`, `workouts` and `sets`. **Shift rule:** a set added to a session the phone already has gets `completedAt + (phoneSession.startedAt - backupSession.startedAt)`.
5. **Cycles.** Let `backupActive` and `phoneActive` be each side's active cycle.
   - Inactive backup cycles absent on the phone are added as they are.
   - **Same id:** the phone's wins.
   - **Different ids:** `backupActive` is put with `isActive: true`. `phoneActive` goes to `deleteCycleIds` if its `routineIds` is empty. Otherwise it is put with `isActive: false`, and `rotationReplaced` is set.
   - **No `backupActive`:** the phone's is untouched.
6. **Settings:** one row:
   - `unitPreference`, `defaultRestSeconds` and `restAlertSound` from the backup;
   - `libraryVersion` from the phone;
   - `lastBackupAt = max(phone.lastBackupAt ?? -Infinity, backup.exportedAt)`;
   - every other field from the phone.

   It is put only if it differs from the phone's row.
7. **References after the merge.** Overlay `put` and `deleteCycleIds` on the phone tables and run `checkReferences`. A problem → `{ ok: false, reason: 'damaged', detail }`.

- [ ] **Step 1: Write the failing tests** in `src/domain/backupMerge.test.ts`

Helpers at the top of the file:
- `applyPlan(phone: BackupTables, plan: MergePlan): BackupTables` overlays `put` by id and removes `deleteCycleIds`.
- `freshPhone(bundled: Exercise[]): BackupTables` returns `emptyTables()` with:
  - `exercises: bundled.map((e) => ({ ...e }))`;
  - one empty active cycle `cycleRow({ id: 'c-fresh', isActive: true })`;
  - `settings: [settingsRow({})]`.
- `BUNDLED` holds two bundled rows: `exerciseRow({ id: 'Side_to_Side_Box_Shuffle', name: 'Side to Side Box Shuffle', measurementType: 'bodyweight_reps', isCustom: false })` and `exerciseRow({ id: 'Barbell_Squat', name: 'Barbell Squat', isCustom: false })`.

Each test below names the wrong implementation it rejects.

```ts
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
```

Then these tests, each as its own `it`, with the fixture changes and assertions given:

- **`keeps the phone's copy when both have the same row`**: rejects backup-wins. Both sides have session `w-1`; phone name `'Phone name'`, backup `'Backup name'`. Assert `w-1` is not in `put.sessions` and `summary.workouts` is `0`.
- **`lets the backup's edit replace a library row the phone never touched`**: rejects ignoring "untouched". Phone has `BUNDLED` unchanged. The backup's `Side_to_Side_Box_Shuffle` is `{ name: 'Lateral Shuffle', measurementType: 'duration' }`. Assert `put.exercises` holds exactly that row and `libraryEdits` is `1`.
- **`keeps a library row the phone edited`**: rejects backup-wins on bundled rows. The phone's shuffle is renamed `'Lateral Shuffle'`, and the backup's is renamed `'Shuffle (backup)'`. Assert nothing is in `put.exercises`.
- **`judges "untouched" by every field, not the name`**: rejects a name-only comparison. The phone's shuffle keeps its bundled name but has `measurementType: 'duration'`. The backup's is renamed. Assert the phone's wins.
- **`treats an absent field and an undefined one as equal`**: rejects strict key comparison. The phone's untouched row carries `instructions: undefined` as a key, and the bundled entry has no `instructions` key. Assert the backup's edit still replaces it.
- **`matches a recreated custom exercise by name and type, ignoring case and spaces`**: rejects matching by id only, and rewriting phone rows.
  - **Phone:** custom `exerciseRow({ id: 'new-id', name: 'Explosive Box Step-Up', measurementType: 'bodyweight_reps' })`, plus a phone set `p-set` on it.
  - **Backup:** custom `{ id: 'old-id', name: '  explosive box step-UP ', measurementType: 'bodyweight_reps' }`, with a routine item, a set and a goal on `old-id`.
  - **Assert:** no `old-id` in `put.exercises`; every backup set, routine item and goal in `put` has `exerciseId: 'new-id'`; `p-set` and `new-id` are absent from `put`; `matchedExercises` is `['Explosive Box Step-Up']`.
- **`keeps same-named custom exercises of different types apart`**: rejects ignoring type. As above, but the backup's type is `'weight_reps'`. Assert `old-id` is added, its references are unchanged, and `matchedExercises` is `[]`.
- **`never name-matches a bundled row`**: rejects matching all exercises. The backup has bundled `{ id: 'Box_Jump_New', name: 'Box Jump', isCustom: false }`, absent from the phone. The phone has a custom `'Box Jump'`. Assert `Box_Jump_New` is added and `matchedExercises` is `[]`.
- **`prefers an unarchived match, then the lowest id`**: rejects first-found. Phone customs named `'Step-Up'` with ids inserted in the order `'c'`, `'a'` (archived), `'b'`. Assert the match is `'b'`.
- **`keeps the rotation when both sides have the same one`**: rejects backup-wins on cycles. Same `c-main` id; the phone has `currentIndex: 1` and the backup `0`. Assert `c-main` is not in `put.cycles`.
- **`removes the empty rotation a fresh phone starts with`**: `freshPhone` with a backup holding active `c-main`. Assert `deleteCycleIds` is `['c-fresh']`, `c-main` is put with `isActive: true`, `rotationReplaced` is `false`, and exactly one cycle is active in `applyPlan`.
- **`sets aside a rotation built on the new phone`**: rejects keep-phone, and deleting a non-empty cycle.
  - **Phone:** active `c-phone` with `routineIds: ['r-phone']`, plus routine `r-phone`.
  - **Backup:** active `c-main`.
  - **Assert:** `c-phone` is put with `isActive: false`; `c-main` is active; `deleteCycleIds` is `[]`; `rotationReplaced` is `true`; exactly one cycle is active after `applyPlan`.
- **`leaves the phone's rotation active when the backup has none`**: the backup's only cycle is inactive. Assert the phone's stays the one active cycle.
- **`shifts a set into a workout that was moved since the backup`**: rejects keeping the old time.
  - **Phone:** session `w-1` with `startedAt: T0 + DAY` and none of its sets.
  - **Backup:** `w-1` with `startedAt: T0`, and set `s-2` with `completedAt: T0 + 5 * MIN`.
  - **Assert:** `s-2`'s put `completedAt` is `T0 + DAY + 5 * MIN`, and a set in a backup-only session keeps its time.
- **`takes three settings from the backup and keeps the phone's library version`**: phone `settingsRow({ libraryVersion: 3, lastBackupAt: undefined })`, backup settings `{ unitPreference: 'kg', defaultRestSeconds: 150, restAlertSound: false, libraryVersion: 1 }`. Assert:
  - the put settings row has `kg`, `150`, `false` and `libraryVersion: 3`;
  - `lastBackupAt` is `backup.exportedAt`.
- **`keeps the later of the two backup dates`**: the phone's `lastBackupAt` is `backup.exportedAt + 5`. Assert it is kept.
- **`adds nothing when the same file is merged twice`**: plan, `applyPlan`, then plan again with the result as the phone. Assert `addsNothing(summary)` is `true`, every table in `put` is empty (settings included, since nothing differs), and `deleteCycleIds` is empty.
- **`refuses while a workout is in progress on the phone`**: assert the exact `in-progress` result.
- **`checks references over the merged result`**:
  - a backup set pointing at a phone-only exercise is `ok` (this rejects checking the file alone);
  - a backup set pointing at an exercise neither side has is `damaged`, with `checkReferences`'s message.

- [ ] **Step 2: Verify they fail** — `npx vitest run src/domain/backupMerge.test.ts` fails: no module.

- [ ] **Step 3: Implement** `backupMerge.ts`. `sameRow` compares canonical JSON with sorted keys, since `JSON.stringify` already drops `undefined` values.

- [ ] **Step 4: Verify** — the focused run passes, and `npx tsc --noEmit` exits 0.

- [ ] **Step 5: Mandated breaks.** One at a time, then restore each:
  - backup-wins on conflict;
  - a name-only "untouched";
  - no `measurementType` in the match;
  - no shift;
  - delete the non-empty phone rotation instead of setting it aside.

  Each must fail at least one test above.

- [ ] **Step 6: Commit** — `feat: plan a restore as a merge, with the matching and rotation rules`

---

### Task 4: Settings writer, backup and restore data functions, and the frozen fixture

**Files:**
- Modify: `src/db/settings.ts` (+ `src/db/settings.test.ts`)
- Create: `src/db/backup.ts`, `src/db/backup.test.ts`, `scripts/make-backup-fixture-v1.ts`, `src/db/fixtures/backup-v1.json`, `src/db/backupFixtureV1.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 3; `db`, `SETTINGS_ID`, `DEFAULT_SETTINGS`; `bundled` from `src/data/exercises.json`, imported as `seed.ts` does. **Do not import `src/db/seed.ts`**: `AppLayout.seedFailure.test.tsx` mocks that module, and Task 6 renders `BackupButton` there.
- Produces:
  - `updateSettings(changes: Partial<Omit<Settings, 'id'>>): Promise<void>` — one rw transaction: read the row, merge `{ ...DEFAULT_SETTINGS, ...stored, ...changes, id: SETTINGS_ID }`, `put`. An `id` smuggled in at runtime is overwritten.
  - `readSnapshot(): Promise<BackupTables>` — one **read-only** transaction across `db.tables`. `settings` is always exactly one row: the stored row merged over `DEFAULT_SETTINGS` (Review Focus 3).
  - `interface PreparedBackup { file: BackupFile; text: string; name: string; problem: string | null }`
  - `createBackup(now = Date.now()): Promise<PreparedBackup>`:
    - `exportedAt: now`, `dbVersion: db.verno`, `libraryVersion: settings.libraryVersion ?? 0`;
    - `text = JSON.stringify(file)`, `name = backupFileName(now)`;
    - `problem = validateTables(tables, now) ?? checkReferences(tables)`;
    - **writes nothing.**
  - `recordBackup(exportedAt: number): Promise<void>` — `updateSettings({ lastBackupAt: exportedAt })`
  - `type RestorePreview = { kind: 'refused'; reason: 'newer' | 'not-backup' | 'damaged' | 'in-progress'; detail: string } | { kind: 'ready'; file: BackupFile; summary: MergeSummary }`
  - `previewRestore(text: string, now = Date.now()): Promise<RestorePreview>` — `parseBackup`, then `planMerge` against `readSnapshot()`. **Writes nothing.**
  - `applyRestore(file: BackupFile): Promise<MergeSummary>`:
    - one rw transaction over `db.tables`;
    - re-reads every table inside it (with the same defaulted settings) and re-plans;
    - throws `new Error(detail)` on a refusal;
    - writes with `bulkPut` in the order exercises, routines, cycles (then `bulkDelete(deleteCycleIds)`), sessions, sets, bodyweight, goals, and **`db.settings.put` last**;
    - returns the summary.

- [ ] **Step 1: Write the failing tests**

`src/db/settings.test.ts` additions:
- **`updateSettings changes only the fields given`**: rejects a put of `changes` alone. Write `{ unitPreference: 'kg' }`, then `{ defaultRestSeconds: 120 }`. Assert both stick, and `restAlertSound` is still `true`.
- **`updateSettings never moves the singleton`**: rejects spreading `changes` last. Call it with `{ id: 'other', unitPreference: 'kg' } as never`. Assert `db.settings.count()` is `1` and the row's id is `SETTINGS_ID`.
- **`the domain's settings id matches the database's`**: `expect(SETTINGS_ROW_ID).toBe(SETTINGS_ID)`.

`src/db/backup.test.ts`. Use `seedExercise`, `seedWorkout`, `T`, `MIN` and `DAY` from `src/testFixtures`. Set up `beforeEach(resetDbForTests)`, and define a `dump()` helper returning `Object.fromEntries(await Promise.all(db.tables.map(async (t) => [t.name, await t.toArray()])))`:

```ts
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
  const db_ = await dump();
  for (const name of TABLE_NAMES.filter((n) => n !== 'settings')) {
    expect(parsed.file.tables[name]).toEqual(db_[name]);
  }
  expect(prepared.name).toBe(backupFileName(T + DAY));
  expect(parsed.file.exportedAt).toBe(T + DAY);
});
```

Then these tests:
- **`creating a backup records nothing`**: rejects recording on create. Assert `(await getSettings()).lastBackupAt` stays `undefined` after `createBackup()`.
- **`still builds a backup from a flawed snapshot, naming the problem`**: seed a workout named `'Moved Push'` with `startedAt: Date.UTC(1999, 5, 1, 17)`. Assert `text` parses as JSON, and `problem` matches `/^Workout "Moved Push" on .+: "startedAt" is before 2000\.$/`.
- **`recordBackup stamps the time and keeps the other settings`**.
- **`previews without writing`**: rejects writing at preview. Snapshot `dump()` before and after `previewRestore(validText)`, and assert they are equal. Assert `kind` is `'ready'` with the expected counts.
- **`refuses to preview while a workout is in progress`**: `seedWorkout({ startedAt: T, status: 'in_progress', endedAt: null })`. Assert `{ kind: 'refused', reason: 'in-progress' }`.
- **`passes a newer-version refusal through`**: assert `reason: 'newer'`.
- **`applies a restore and returns what it added`**: build the file from `fullTables()` via `backupFile`, after a `prepareLibrary()` so the phone looks real. Assert the rows land and `summary.workouts` is `1`.
- **`adds nothing when the same file is applied twice`** (Review Focus 2): the second `applyRestore` resolves, `addsNothing` is `true`, and `dump()` is unchanged from after the first.
- **`writes nothing when the last write fails`**: rejects per-table transactions. `fullTables()`'s settings differ from the phone's defaults, so the settings write really happens, and it happens last.

  ```ts
  const before = await dump();
  vi.spyOn(db.settings, 'put').mockRejectedValueOnce(new Error('disk on fire'));
  await expect(applyRestore(file)).rejects.toThrow('disk on fire');
  expect(await dump()).toEqual(before);
  ```

- **`re-plans from what is on the phone when it applies`**: rejects replaying the preview's plan.
  1. Preview a file that adds session `w-1` named `'Upper A'`.
  2. Then write a phone session with id `w-1` and name `'Phone copy'`.
  3. Apply.
  4. Assert the name is `'Phone copy'` and the summary's `workouts` is `0`.
- **`refuses to apply while a workout is in progress, writing nothing`**.

`scripts/make-backup-fixture-v1.ts`. It runs once, with `npx tsx scripts/make-backup-fixture-v1.ts`. Its header says: *Generates the frozen version-1 fixture from the app's own write functions. Never re-run it to make a failing fixture test pass; that test exists to fail.* It imports `fake-indexeddb/auto` first, then uses only the app's functions:
1. Prepare the library: `prepareLibrary()`.
2. Exercises:
   - `updateExercise('Side_to_Side_Box_Shuffle', { name: 'Lateral Shuffle', measurementType: 'duration' })`;
   - `createCustomExercise({ name: 'Explosive Box Step-Up', primaryMuscles: ['quads'], secondaryMuscles: ['glutes'], equipment: 'other', measurementType: 'bodyweight_reps' })`.
3. Routine and rotation:
   - `createRoutine('Lower A')`, with `setRoutineItems` holding three items: `Barbell_Squat` with targets 3 × 6–8 and rest 150; the step-up; the shuffle;
   - `getOrCreateActiveCycle()`, then `saveCycle` containing it.
4. The first workout:
   - `startSession`, then `logSet`: squat 135 lb × 5 warm-up; squat 22.5 kg × 8; step-up × 6; shuffle 20 s;
   - `finishSession`;
   - `moveSession` it back 3 days.
5. The second workout: `startSession` again, and log one squat set, **leaving it in progress**.
6. Settings: `updateSettings({ unitPreference: 'kg', restAlertSound: false })`.
7. Back up: `createBackup()`, and `recordBackup` its `exportedAt`. Fail loudly if `problem` is not `null`.
8. Trim and write:
   - drop exercises equal to their bundled entry (`sameRow`), so the fixture stays small and also exercises references to phone-only rows;
   - write the result pretty-printed (2 spaces, trailing newline) to `src/db/fixtures/backup-v1.json`.

`src/db/backupFixtureV1.test.ts`:

```ts
import fixture from './fixtures/backup-v1.json';

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
```

- [ ] **Step 2: Verify they fail** — the settings and backup tests fail with no export; the fixture test fails because the file doesn't exist.

- [ ] **Step 3: Implement** `updateSettings` and `src/db/backup.ts`.

- [ ] **Step 4: Generate the fixture** — `npx tsx scripts/make-backup-fixture-v1.ts`. Open the JSON and check it holds:
  - the two exercises;
  - one routine and one active cycle;
  - two sessions, one of them in progress;
  - a `22.5` with unit `kg`, and a set with `durationSeconds: 20`;
  - `formatVersion: 1`.

- [ ] **Step 5: Verify** — `npx vitest run src/db` passes, and `npx tsc --noEmit` exits 0.

- [ ] **Step 6: Mandated breaks.** One at a time, then restore each:
  - make `applyRestore` write each table in its own transaction → `writes nothing when the last write fails` fails;
  - make `createBackup` call `recordBackup` → `creating a backup records nothing` fails;
  - make `readSnapshot` return the raw settings row → `fills settings defaults…` fails.

- [ ] **Step 7: Commit** — `feat: back up and restore the database, and freeze a version-1 fixture`

---

### Task 5: Back up now

**Files:**
- Create: `src/pwa/shareFile.ts`, `src/ui/backup/BackupButton.tsx`, `src/ui/backup/BackupButton.test.tsx`

**Interfaces:**
- Consumes: Task 4 `createBackup`, `recordBackup`; `useWriteError`.
- Produces:
  - `canShareFiles(file: File): boolean` — `typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })`
  - `shareFile(file: File): Promise<'saved' | 'cancelled' | 'expired'>` — `navigator.share({ files: [file] })`. Resolve → `'saved'`; `AbortError` → `'cancelled'`; `NotAllowedError` → `'expired'`; anything else rethrown.
  - `downloadFile(file: File): void` — `<a download={file.name}>` on a blob URL, revoked after 60 s
  - `BackupButton()` — no props; router-free

**Component contract:**
- **Button:** `Back up now` (`type="button"`), **disabled while a backup is in flight**.
- **Flow:**
  1. `createBackup()`, then `new File([text], name, { type: 'application/json' })`.
  2. If `canShareFiles`, then `shareFile`:
     - `'saved'` → record and report;
     - `'cancelled'` → back to idle, no message;
     - `'expired'` → the button is replaced by **`Save backup file`**, which holds the same `File`. Its click shares it again and handles the outcome the same way.
  3. If not, `downloadFile` → record and report.
- **"Record and report":**
  - If `problem` is `null` → `run(() => recordBackup(file.exportedAt))`, then `<p role="status">Backup saved.</p>`. If the record fails: `<p role="alert">Backup saved, but the app couldn't record the date, so the reminder won't reset.</p>`.
  - If `problem` is set → record nothing, and show `<p role="alert">This backup saved, but it has a problem that would stop it restoring: {problem}</p>`.
- **Any other error** (from `createBackup` or `shareFile`) → `<p role="alert">{message}</p>`.
- **Never render `WriteErrorAlert` here.** Task 6 renders `BackupButton` inside it.

- [ ] **Step 1: Write the failing tests** in `src/ui/backup/BackupButton.test.tsx`

Helpers:

```ts
function stubShare(impl: (data: ShareData) => Promise<void>) {
  const share = vi.fn(impl);
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
  Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
  return share;
}
afterEach(() => {
  delete (navigator as { share?: unknown }).share;
  delete (navigator as { canShare?: unknown }).canShare;
});
const lastBackupAt = async () => (await getSettings()).lastBackupAt;
```

```ts
it('shares the backup as a JSON file and records it when the sheet reports success', async () => {
  const user = userEvent.setup();
  const ex = await seedExercise();
  await seedWorkout({ startedAt: T, sets: [{ exerciseId: ex.id, weight: 22.5, reps: 8, completedAt: T + MIN }] });
  const share = stubShare(async () => {});
  render(<BackupButton />);
  await user.click(screen.getByRole('button', { name: 'Back up now' }));
  expect(await screen.findByRole('status')).toHaveTextContent(/^Backup saved\.$/);
  expect(share).toHaveBeenCalledTimes(1);
  const file = share.mock.calls[0][0].files![0];
  expect(file.name).toMatch(/^workout-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
  expect(file.type).toBe('application/json');
  const parsed = parseBackup(await file.text(), Date.now());
  if (!parsed.ok) throw new Error(parsed.detail);
  expect(parsed.file.tables.sets).toEqual(await db.sets.toArray());
  expect(await lastBackupAt()).toBe(parsed.file.exportedAt);
});
```

Then these tests:
- **`records nothing and says nothing when the user backs out`**: rejects recording before the share settles. Share rejects with `new DOMException('', 'AbortError')`. Wait for the button to be enabled again, then assert `lastBackupAt` is `undefined` and there is no `alert` or `status`.
- **`offers a second tap when iOS says the tap expired`**: the share rejects once with `NotAllowedError`, then resolves.
  - After the first click: `Save backup file` is shown, `Back up now` is gone, and nothing is recorded.
  - After clicking it: `share` has been called twice, `toBe` the same `File` object, and `lastBackupAt` is set.
- **`shows any other share failure`**: the share rejects with `new TypeError('Share failed')`. Assert the `alert` reads `Share failed` and nothing is recorded.
- **`downloads when the browser cannot share files`**: rejects recording only after a share.
  - Set up: no stub; stub `URL.createObjectURL` and `URL.revokeObjectURL` (jsdom lacks them) with `vi.fn(() => 'blob:x')`; spy on `HTMLAnchorElement.prototype.click`.
  - Assert: the clicked anchor's `download` matches the file-name pattern, and `lastBackupAt` is set.
- **`saves a flawed snapshot but warns and leaves the reminder`**: rejects refusing to save, and recording a flawed backup.
  - Set up: seed `'Moved Push'` at `Date.UTC(1999, 5, 1, 17)`; the share resolves.
  - Assert: `share` was called; the `alert` contains `This backup saved, but it has a problem that would stop it restoring:` and `Moved Push`; `lastBackupAt` is `undefined`.
- **`cannot start a second backup while one is in flight`** (Review Focus 1): rejects no busy guard. The share returns a promise you resolve by hand. Click; assert the button is disabled; click again; assert `share` was called once. Then resolve it and wait for `Backup saved.`.

- [ ] **Step 2: Verify they fail** — no module.

- [ ] **Step 3: Implement** `shareFile.ts` and `BackupButton.tsx`.

- [ ] **Step 4: Verify** — `npx vitest run src/ui/backup` passes, and `npx tsc --noEmit` exits 0.

- [ ] **Step 5: Mandated break** — record before awaiting `shareFile` → the back-out test fails. Restore.

- [ ] **Step 6: Commit** — `feat: back up through the share sheet, with a second tap when iOS expires the first`

---

### Task 6: Storage full, everywhere

**Files:**
- Modify: `src/ui/useWriteError.ts` (+ test), every screen listed below, `src/ui/routines/RoutinesScreen.tsx` (+ test), `src/ui/library/CustomExerciseForm.tsx` (+ test), `src/ui/AppLayout.tsx`, `src/ui/AppLayout.seedFailure.test.tsx`
- Create: `src/ui/WriteErrorAlert.tsx`, `src/ui/WriteErrorAlert.test.tsx`

**Interfaces:**
- Consumes: Task 5 `BackupButton`.
- Produces:
  - `STORAGE_FULL_MESSAGE = "Couldn't save: your phone is out of space for this app. What you typed is still here. Back up now so nothing is lost."`
  - `isQuotaError(e: unknown): boolean` — `name === 'QuotaExceededError'` on the error, or anywhere down its `inner` chain (Dexie wraps aborts)
  - `run` stores `STORAGE_FULL_MESSAGE` for a quota error, and the error's message otherwise
  - `WriteErrorAlert({ error }: { error: string | null })`:
    - `null` → nothing;
    - `STORAGE_FULL_MESSAGE` → `<div role="alert"><p>{message}</p><BackupButton /></div>`;
    - otherwise `<p role="alert">{error}</p>`.

**Every `{error && <p role="alert">{error}</p>}` that renders a `run` error becomes `<WriteErrorAlert error={error} />`:**
- `CycleEditor` (2), `PastWorkoutScreen` (1), `RoutineEditor` (the `error` one only, not `prescriptionError`), `RoutinesScreen` (2), `ActiveSessionScreen` (3), `TodayScreen` (2), and `CustomExerciseForm`.
- "Not found" and "no longer available" alerts are not write errors and stay as they are.

**`RoutinesScreen`:**
- Create and archive go through a `useWriteError()`. The restore list keeps its own.
- The name field clears only when `run` resolves `true`.

**`CustomExerciseForm`:**
- Its validation checks throw inside the `run` callback, so there is still one error surface, with the same messages.
- `onDone()` runs only when `run` resolves `true`.

**`AppLayout`:** when `prepareLibrary` rejects with a quota error, it renders `<WriteErrorAlert error={STORAGE_FULL_MESSAGE} />` in place of "Could not open the database…". Any other failure keeps the existing message.

- [ ] **Step 1: Write the failing tests**

`src/ui/useWriteError.test.tsx`:
- **`turns a quota error into the storage-full message`**: `run(async () => { throw new DOMException('full', 'QuotaExceededError'); })`. Assert `error` is `STORAGE_FULL_MESSAGE`.
- **`finds a quota error inside a Dexie abort`**: throw `Object.assign(new Error('Transaction aborted'), { name: 'AbortError', inner: new DOMException('full', 'QuotaExceededError') })`. Assert the same.
- The existing test keeps any other error's own message.

`src/ui/WriteErrorAlert.test.tsx`:
- the storage-full case renders the message and a `Back up now` button inside one `alert`;
- another message renders it with no button;
- `null` renders no `alert`.

`src/ui/routines/RoutinesScreen.test.tsx` (add `within` to its testing-library import, and `db` from `../../db/db`):

```ts
it('offers a backup when storage is full, keeping the typed name', async () => {
  const user = userEvent.setup();
  vi.spyOn(db.routines, 'add').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
  renderScreen();
  await user.type(screen.getByLabelText('New routine name'), 'Upper A');
  await user.click(screen.getByRole('button', { name: 'Add routine' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(STORAGE_FULL_MESSAGE);
  expect(within(alert).getByRole('button', { name: 'Back up now' })).toBeInTheDocument();
  expect(screen.getByLabelText('New routine name')).toHaveValue('Upper A');
});
```

Plus the same for **archiving**: spy on `db.routines.update`, then assert the alert and its button.

`src/ui/library/CustomExerciseForm.test.tsx`: spy on `db.exercises.add` to reject with the quota error, then `fillRequired` and Save. Assert:
- the alert holds `STORAGE_FULL_MESSAGE` and `Back up now`;
- the name field still holds what was typed;
- `onDone` was not called.

The existing validation-message tests must still pass unchanged.

`src/ui/AppLayout.seedFailure.test.tsx`:
- **`offers a backup when the library cannot be written for lack of space`**: `prepareLibrary` rejects with the quota error. Assert the alert holds `STORAGE_FULL_MESSAGE` and a `Back up now` button, and the routed child is absent.
- The existing `disk on fire` test still shows the old message.

- [ ] **Step 2: Verify they fail.**

- [ ] **Step 3: Implement**, including the replacement at every listed site.

- [ ] **Step 4: Verify** — `npx vitest run src/ui` passes, the full suite passes (`npx vitest run --fileParallelism=false`), and `npx tsc --noEmit` exits 0.

- [ ] **Step 5: Mandated break** — make `isQuotaError` check only the top-level `name` → the Dexie-abort test fails. Restore.

- [ ] **Step 6: Commit** — `feat: turn storage-full on any write into a prompt to back up`

---

### Task 7: The Settings screen and the gear

**Files:**
- Create: `src/ui/settings/SettingsScreen.tsx`, `src/ui/settings/SettingsScreen.test.tsx`, `src/domain/backupReminder.ts`, `src/domain/backupReminder.test.ts`
- Modify: `src/App.tsx`, `src/App.test.tsx`, `src/ui/AppLayout.tsx`, `src/ui/AppLayout.test.tsx`

**Interfaces:**
- Consumes: `getSettings`, `updateSettings`, `getInProgressSession`, `BackupButton`, `WriteErrorAlert`.
- Produces:
  - `daysAgoLabel(then: number, now: number): string` in `backupReminder.ts`. The count is `Math.floor((now - then) / DAY)`: `0` → `today`, `1` → `1 day ago`, `n` → `` `${n} days ago` ``.
  - `SettingsScreen` at `/settings`, and a header gear `<Link to="/settings" aria-label="Settings">⚙︎</Link>` in `AppLayout`, after the `<h1>`.
  - A `restore` slot: Task 8 fills it. In this task, render nothing there.

**Screen contract**, in this order:
1. `<h2>Settings</h2>`.
2. **One querier:** `{ settings: await getSettings(), inProgress: await getInProgressSession() }`. The storage status comes from a `useEffect`, since it isn't a Dexie read.
3. `<h3>Weights</h3>` and a `<fieldset>` with `<legend>Unit for exercises you haven't logged yet</legend>`. Inside it, two radios named `lb` and `kg`, checked from settings. A change writes `run(() => updateSettings({ unitPreference }))`.
4. `<h3>Rest</h3>`, then `<form noValidate>` holding `<label>Default rest between sets (seconds)<input type="number" inputMode="numeric" /></label>`, followed by `<p>A routine's own rest time still wins.</p>`.
   - **Draft:** the field shows the draft or the stored value.
   - **Commit** on blur and on submit.
   - **Valid input** is `/^\d+$/` and ≥ 1. Anything else shows `<p role="alert">Rest must be a whole number of seconds, at least 1.</p>`, writes nothing, and keeps the draft.
   - **A failed write** keeps the draft, too.
5. `<label><input type="checkbox" />Sound when rest ends</label>`, writing `restAlertSound`.
6. `<h3>Backup</h3>`, then `<p>Last backup: {date} · {daysAgoLabel}</p>` using `toLocaleDateString`, or `<p>Last backup: Never</p>`. Then `<BackupButton />`, then the restore slot.
7. `<h3>Storage</h3>`, then `<p>Protected from iOS clean-up: {Yes|No|Unknown}</p>` and `<p>iOS may clear this app's data when the phone runs low on space. Your backups are the safety net.</p>`. `Unknown` covers both a missing `navigator.storage?.persisted` and a rejection.
8. `<WriteErrorAlert error={error} />` near the top.

- [ ] **Step 1: Write the failing tests**

`src/domain/backupReminder.test.ts`:

```ts
it.each([
  [0, 'today'], [DAY - 1, 'today'], [DAY, '1 day ago'], [2 * DAY - 1, '1 day ago'], [15 * DAY, '15 days ago'],
])('labels %d ms ago as %s', (elapsed, label) => {
  expect(daysAgoLabel(NOW - elapsed, NOW)).toBe(label);
});
```

`src/ui/settings/SettingsScreen.test.tsx` renders `<MemoryRouter><SettingsScreen /></MemoryRouter>`, with `beforeEach(resetDbForTests)`:
- **`saves the unit as soon as it changes`**: click radio `kg`, then poll that `getSettings()` has `unitPreference: 'kg'`. Re-query and assert radio `kg` is checked.
- **`saves the default rest when the field is left`**: clear the field, type `120`, `tab`. Poll for `defaultRestSeconds: 120`.
- **`refuses a rest that isn't a whole number of seconds, keeping what was typed`**: rejects a write of the coerced value. For each of `0`, `1.5` and an emptied field, type it and tab. Not letters: jsdom sanitises them out of a number input. Assert the alert copy, that `defaultRestSeconds` is still `90`, and that the field shows what was typed.
- **`keeps the typed rest when the write fails`**: `vi.spyOn(db.settings, 'put').mockRejectedValueOnce(new Error('disk on fire'))`. Type `120` and tab. Assert the alert is `disk on fire`, and the re-queried field holds `120`.
- **`turns the rest sound off`**: assert `restAlertSound: false`.
- **`says when the last backup was`**:
  - with no backup → `Last backup: Never`;
  - after `updateSettings({ lastBackupAt: Date.now() - 3 * DAY })` → `` `Last backup: ${new Date(at).toLocaleDateString()} · 3 days ago` ``.
- **`shows whether iOS has protected the storage`**: stub `navigator.storage` with `{ persisted: async () => true }`, then `false`, then remove it. Assert `Yes`, `No` and `Unknown`. Restore it in `afterEach`.
- **`offers Back up now`**: assert a button by that name.

`src/ui/AppLayout.test.tsx`:
- **`opens Settings from the gear on every screen`**: from `/` and from `/routines`, the link named `Settings` has `href` `/settings`.

`src/App.test.tsx`:
- **`routes /settings to the Settings screen`**, in the same `import.meta.env.BASE_URL` pattern as the existing `/history` test, with heading `Settings`.

- [ ] **Step 2: Verify they fail.**

- [ ] **Step 3: Implement** the screen, the label function, the route and the gear.

- [ ] **Step 4: Verify** — `npx vitest run src/ui/settings src/domain/backupReminder.test.ts src/ui/AppLayout.test.tsx src/App.test.tsx` passes, and `npx tsc --noEmit` exits 0.

- [ ] **Step 5: Commit** — `feat: add the Settings screen behind a gear`

---

### Task 8: Restore from a backup

**Files:**
- Create: `src/ui/settings/RestoreControl.tsx`, `src/ui/settings/RestoreControl.test.tsx`
- Modify: `src/ui/settings/SettingsScreen.tsx` (fill the restore slot with `<RestoreControl inProgress={!!data.inProgress} />`)

**Interfaces:**
- Consumes: Task 4 `previewRestore`, `applyRestore`; Task 3 `MergeSummary`, `addsNothing`; `useWriteError`, `WriteErrorAlert`.
- Produces: `RestoreControl({ inProgress }: { inProgress: boolean })` — router-free.

**Control contract:**
- **While `inProgress`:** a disabled `<button>Restore from backup…</button>`, then `<p>Finish or discard your workout in progress before restoring.</p>`.
- **Otherwise:** `<label>Restore from backup…<input type="file" accept=".json,application/json" /></label>`. Choosing a file reads `await file.text()`, then calls `previewRestore`.
- **Refusals**, each in one `<div role="alert">`:
  - `newer`: `This backup can't be restored. It was made by a newer version of the app. Open the app while you're online so it updates, then try again. Nothing on this phone was changed.`
  - `not-backup` and `damaged`: `This isn't a workout backup, or it's damaged. Nothing on this phone was changed.`, then `<small>{detail}</small>`.
  - `in-progress`: `Finish or discard your workout in progress before restoring. Nothing on this phone was changed.`
- **Ready, with `addsNothing(summary)`:** `<p role="status">Everything in this backup is already on this phone.</p>`. Nothing is written, settings included. *(Plan ruling: the spec shows this as Restore's result. Deciding it at preview time avoids a no-op write, and a backup of this phone's own data already carries its settings.)*
- **Ready otherwise:** the confirmation:
  - `<h3>Restore this backup?</h3>`, `<p>{file name}</p>` and `` <p>Made {toLocaleString(exportedAt)}</p> ``;
  - `<p>This adds:</p>`, then a `<ul>` holding these items, in this order, each only when non-zero:
    - `` `${w} workout(s) (${s} set(s))` ``, or, with no new workouts but some new sets, `` `${s} set(s) in workouts already on this phone` ``;
    - `` `${r} routine(s)` ``;
    - `` `${c} custom exercise(s)` ``;
    - `` `your edits to ${e} library exercise(s)` ``;
    - one `` `${name}: history joins the copy already on this phone` `` per matched name;
    - `Your rotation from the backup replaces the one on this phone` when `rotationReplaced`.
  - `` <p>Nothing already on this phone is removed. Settings switch to the backup's: {unit}, {rest} s rest, sound {on|off}.</p> ``
  - **Restore** and **Cancel** buttons.
  - Plurals are exact: `1 workout`, `2 workouts`; `1 set`, `2 sets`; and likewise for every other noun.
- **Restore:** `run(() => applyRestore(file))`, with **Restore disabled while it runs**. Success shows `<p role="status">Restored.</p>` and the same list, built from the **returned** summary. A failure shows `WriteErrorAlert`, and the confirmation stays.
- **Cancel:** clears everything, and writes nothing.

- [ ] **Step 1: Write the failing tests** in `src/ui/settings/RestoreControl.test.tsx`

Build files with the Task 1 test rows: `const text = JSON.stringify(backupFile(fullTables(), Date.now() - DAY))`. Upload with `user.upload(screen.getByLabelText('Restore from backup…'), new File([text], 'workout-backup-2026-10-20-2205.json', { type: 'application/json' }))`. Run `prepareLibrary()` in `beforeEach`, after the reset.

- **`shows what a backup adds before writing anything`**: rejects writing at preview.
  - Assert the heading, the file name, `Made …`, and the list items `1 workout (1 set)`, `1 routine` and `1 custom exercise`, matched with `/^1 workout \(1 set\)$/` and the like.
  - Assert the settings line: `kg, 120 s rest, sound off`.
  - Assert `db.sessions.count()` is still `0`.
- **`restores on confirm and says what it added`**: click Restore, then find `Restored.`. Assert `w-1` is in the database.
- **`cancels without writing`**.
- **`names a matched exercise and a replaced rotation`**:
  - **Before rendering:** create custom `'Explosive Box Step-Up'` (`bodyweight_reps`) and a routine `'Phone Day'`, and put the routine in the active cycle.
  - **Assert:** `Explosive Box Step-Up: history joins the copy already on this phone` and `Your rotation from the backup replaces the one on this phone`.
- **`refuses a newer backup, changing nothing`**: assert the exact copy, and that `db.sessions.count()` is `0`.
- **`refuses a damaged file with the reason in small print`**: upload `'{"format": '`. Assert the copy and `The file isn't valid JSON.`.
- **`says when everything is already here`**: apply the file first through `applyRestore`, then upload it again. Assert the status, and that there is no Restore button.
- **`disables Restore while it runs`** (Review Focus 2): rejects no guard.
  1. Hold `applyRestore` on a promise you resolve by hand. Don't stall a Dexie write for this: awaiting a foreign promise inside a transaction commits it early. Instead, mock the module once at the top of the file, keeping the real function as the default: `vi.mock('../../db/backup', async (orig) => { const real = await orig<typeof import('../../db/backup')>(); return { ...real, applyRestore: vi.fn(real.applyRestore) }; })`. In this test, `vi.mocked(applyRestore).mockImplementationOnce(() => held.promise)`.
  2. Click Restore. Assert it is disabled.
  3. Resolve the promise with a summary, then find `Restored.`.
- **`is disabled while a workout is in progress`**: render with `inProgress` set. Assert the disabled button, the copy, and that there is no file input.

- [ ] **Step 2: Verify they fail.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Verify** — `npx vitest run src/ui/settings` passes, and `npx tsc --noEmit` exits 0.

- [ ] **Step 5: Commit** — `feat: restore a backup from Settings, confirming what it adds`

---

### Task 9: The backup reminder on Today

**Files:**
- Modify: `src/domain/backupReminder.ts` (+ test), `src/ui/today/TodayScreen.tsx` (+ test)

**Interfaces:**
- Consumes: `getSettings`, `listCompletedSessions`, `BackupButton`.
- Produces: `backupReminder(lastBackupAt: number | undefined, completedStarts: number[], now: number): { kind: 'none' } | { kind: 'never' } | { kind: 'stale'; days: number }`, following the spec's rule:
  - `pending` = the starts after `lastBackupAt` (all of them if it is unset). None → `none`.
  - `anchor = lastBackupAt ?? Math.min(...pending)`. If `now - anchor > 14 * DAY`: `never` when it is unset, otherwise `stale` with `days = Math.floor((now - lastBackupAt) / DAY)`. Else `none`.

**Today:** its existing `data` querier also returns `lastBackupAt: (await getSettings()).lastBackupAt` and `completedStarts: (await listCompletedSessions()).map((s) => s.startedAt)`. **No new querier.** Once `data` is loaded, a reminder renders at the top of the section in both the empty-rotation branch and the main one:
- `<div role="status"><p>Last backup was {days} days ago.</p><BackupButton /></div>`;
- or `<p>You haven't backed up yet.</p>` in the same wrapper.

It is computed with `Date.now()` at render.

- [ ] **Step 1: Write the failing tests**

`src/domain/backupReminder.test.ts`:

```ts
const B = NOW - 20 * DAY;
it.each<[string, number | undefined, number[], ReturnType<typeof backupReminder>]>([
  ['nothing logged, never backed up', undefined, [], { kind: 'none' }],
  ['first workout exactly 14 days ago', undefined, [NOW - 14 * DAY], { kind: 'none' }],
  ['first workout 14 days and 1 ms ago', undefined, [NOW - 14 * DAY - 1], { kind: 'never' }],
  ['nothing since a stale backup', B, [B - DAY], { kind: 'none' }],
  ['a workout since a stale backup', B, [B + DAY], { kind: 'stale', days: 20 }],
  ['a backup exactly 14 days old', NOW - 14 * DAY, [NOW - DAY], { kind: 'none' }],
  ['a backup 14 days and 1 ms old', NOW - 14 * DAY - 1, [NOW - DAY], { kind: 'stale', days: 14 }],
  // Starts listed newest first, so Math.min, not [0], must pick the anchor.
  ['never backed up, oldest of several', undefined, [NOW - DAY, NOW - 15 * DAY, NOW - 3 * DAY], { kind: 'never' }],
])('%s', (_label, last, starts, expected) => {
  expect(backupReminder(last, starts, NOW)).toEqual(expected);
});
```

`src/ui/today/TodayScreen.test.tsx`. Use times relative to `Date.now()`, because Today reads the real clock:
- **`reminds when the first workout is over two weeks old and there is no backup`**: `seedWorkout({ startedAt: Date.now() - 15 * DAY })`. Assert `You haven't backed up yet.` and a `Back up now` button.
- **`says how old the last backup is`**: `updateSettings({ lastBackupAt: Date.now() - 16 * DAY })` plus a workout 10 days ago. Assert the text matches `/^Last backup was 16 days ago\.$/` exactly, via `getByText`.
- **`shows no reminder when nothing new has been logged`**: a backup 30 days ago and a workout 31 days ago. Assert `queryByText(/backed up|Last backup/)` is `null`. Mandated break: drop the `pending` check.
- **`reminds even before a rotation exists`**: an empty rotation plus a workout 15 days old. Assert the reminder and `Nothing in your rotation yet` both show.

- [ ] **Step 2: Verify they fail.**

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Verify** — `npx vitest run src/domain/backupReminder.test.ts src/ui/today` passes, and `npx tsc --noEmit` exits 0.

- [ ] **Step 5: Commit** — `feat: remind on Today when the last backup is over two weeks old`

---

### Task 10: The round trip in WebKit, gating the deploy

**Files:**
- Create: `playwright.config.ts`, `e2e/backup-roundtrip.spec.ts`
- Modify: `package.json` (`@playwright/test` devDependency; script `"test:e2e": "npm run build && playwright test"`), `vite.config.ts` (add `'e2e/**'` to `test.exclude`), `tsconfig.json` (add `"e2e"` and `"playwright.config.ts"` to `include`), `.gitignore` (`test-results/`, `playwright-report/`), `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: the whole app, through its UI only. The test may read IndexedDB raw, and it may stub `navigator.share`.
- Produces: `npm run test:e2e`, and a CI step that fails the deploy when it fails.

**Setup.** The user approved the download on 2026-10-20:
- `npm install --save-dev @playwright/test`;
- `npx playwright install webkit`.

**`playwright.config.ts`:**
- `testDir: 'e2e'`;
- one project, `{ name: 'webkit', use: { ...devices['iPhone 13'] } }` (WebKit, iPhone viewport);
- `use.baseURL: 'http://localhost:4173/workout-tracker/'`;
- `webServer: { command: 'npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173/workout-tracker/', reuseExistingServer: !process.env.CI }`;
- `forbidOnly: !!process.env.CI`, `retries: 0`.

It serves the existing `dist/`, which is why `test:e2e` builds first.

**`e2e/backup-roundtrip.spec.ts`**: one test. Selectors are the implementer's, read from the screens.

1. **Context A:** `addInitScript` before the first navigation:

   ```js
   window.__shared = [];
   Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
   Object.defineProperty(navigator, 'share', { value: async ({ files }) => { window.__shared.push(...files); }, configurable: true });
   ```

2. **Through the UI, in A:**
   1. In the Library, rename `Side to Side Box Shuffle` to `Lateral Shuffle` and change its type to Duration.
   2. Create the custom exercise `Explosive Box Step-Up`.
   3. Create routine `Upper A` (the step-up, then Lateral Shuffle) and routine `Lower A` (`Barbell Squat`). Put both in the rotation.
   4. From Today, start `Upper A`. Log the step-up for 6 reps, and Lateral Shuffle for 20 seconds. Finish.
   5. Start `Lower A`, with the unit still the default `lb`. Log a warm-up of `135` × 5, then a working set of `22.5` × 8. Finish.
   6. Settings: set the unit to `kg` and change the rest to `120`.
   7. Start `Upper A` again. Add `Barbell Bench Press - Medium Grip` through the session's exercise picker; it has no history, so it takes the `kg` default. Log `60` × 5. Finish.
3. **In A:** Settings → Back up now. Wait for `Backup saved.`. Read `window.__shared[0]`'s `name` and `text()`.
4. **Context B:** new and empty. Open `/workout-tracker/`, wait for Today, then go to Settings. `setInputFiles` on `Restore from backup…` with `{ name, mimeType: 'application/json', buffer: Buffer.from(text) }`. Click Restore, then wait for `Restored.`.
5. **The comparison:**
   - `dumpDatabase(page)` reads **raw IndexedDB**, never the app's exporter (the code is below).
   - `expect(dumpB).toEqual(dumpA)` across every store, settings included, since both hold `lastBackupAt === exportedAt`. Then assert `JSON.parse(text).exportedAt` equals `dumpB.settings[0].lastBackupAt`.
6. **Non-vacuity**, asserted on `dumpB`:
   - a set with `weight: 22.5` and `unit: 'lb'` whose `completedAt` equals the same id's in `dumpA`;
   - a set with `unit: 'kg'`;
   - a `warmup` set;
   - a set with `durationSeconds: 20`;
   - an exercise named `Explosive Box Step-Up` with `isCustom: true`;
   - `Side_to_Side_Box_Shuffle` named `Lateral Shuffle`;
   - exactly one cycle, and it is active;
   - `dumpB.sets.length` at least 5.

```ts
async function dumpDatabase(page: Page): Promise<Record<string, unknown[]>> {
  return page.evaluate(() => new Promise<Record<string, unknown[]>>((resolve, reject) => {
    const open = indexedDB.open('workout-tracker');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const idb = open.result;
      const names = Array.from(idb.objectStoreNames);
      const tx = idb.transaction(names, 'readonly');
      const out: Record<string, unknown[]> = {};
      for (const n of names) {
        const req = tx.objectStore(n).getAll();
        req.onsuccess = () => { out[n] = req.result; };
      }
      tx.oncomplete = () => { idb.close(); resolve(out); };
      tx.onerror = () => reject(tx.error);
    };
  }));
}
```

**`deploy.yml`:**
- **The e2e gate:** after `npm run build`, add `npx playwright install --with-deps webkit` and `npx playwright test`, both before `configure-pages`, so a failing round trip blocks the upload.
  - *Plan ruling:* the spec says "before the build". The test runs against the built output, so it has to come after the build. It still runs before the upload, which is what makes it a gate.
- **Bump each action to its current major on the Node 24 runtime.** Confirm each with `gh api repos/<owner>/<action>/releases/latest --jq .tag_name` and its `action.yml` `runs.using`. The actions are `checkout`, `setup-node`, `configure-pages`, `upload-pages-artifact` and `deploy-pages`.

- [ ] **Step 1: Install** — the two commands above. `npx playwright --version` prints a version.

- [ ] **Step 2: Write the test** as specified.

- [ ] **Step 3: Verify it fails for the right reason.** Temporarily make `applyRestore` skip the `sets` table: `npm run test:e2e` must fail on the dump comparison. Restore it.

- [ ] **Step 4: Verify** — `npm run test:e2e` passes. `npx vitest run --fileParallelism=false` still reports the Vitest-only file count, so `e2e/` is not collected. `npx tsc --noEmit` exits 0.

- [ ] **Step 5: Commit** — `test: prove the backup round trip in WebKit and gate the deploy on it`

- [ ] **Step 6: CI** — push the branch and run the workflow with `workflow_dispatch` against it, if the user allows. Otherwise note that CI is unproven until merge.

---

## After the plan

- **Do not merge.** The user's phone check is the last gate. Its steps are in the spec's "The phone check before merging".
- **The final message lists every ruling made while executing,** each with what it costs if wrong. That includes this plan's two rulings:
  - "Everything in this backup is already on this phone" is decided at preview time, and nothing is written, settings included.
  - The e2e test runs after the build in CI, not before it.
- **Then write the 6b handoff.** Template import reuses `planMerge`'s apply path. The 6c list is in the spec's "Recorded for later".
