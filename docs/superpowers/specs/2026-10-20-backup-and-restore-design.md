# Backup and Restore — Design Spec

**Plan 6a.** A Settings screen, a backup file saved to iCloud Drive through the share
sheet, a merging all-or-nothing restore, a backup reminder, a storage-full prompt, and the
one end-to-end round-trip test the parent design calls the most valuable in the suite.

The parent design (`2026-08-04-workout-tracker-design.md`) requires backup in v1 and set
its rules: all-or-nothing, a single transaction, a schema-version gate, a 14-day prompt and
a quota prompt. This spec settles what it left open. The user answered the scoping
questions on 2026-10-20 and reviewed mockups of every screen. They answered two more on
2026-10-29, both raised by a design review of an earlier draft. Every decision below that
is not one of their answers is marked **(my call)**, so it can be checked and overturned.

## Why this exists

Every logged workout lives in exactly one place: this phone's IndexedDB. iOS reclaims web
storage more aggressively than native app storage, and the on-device test below found that
iOS had not granted this origin persistent storage. A new phone, or a wiped app, loses
everything. The parent design calls a corrupt backup "the only unrecoverable failure in
the app", which is why the round-trip test below exists.

## How Plan 6 was split

The roadmap's Plan 6 held backup, program template import and undefined "hardening". It
looked like several projects, as the original Plan 3 did before it was split. The user
agreed this order:

- **6a — this spec.** Settings, backup, restore, reminder, quota prompt, round-trip test.
- **6b — Program template import**, built on 6a's transactional import.
- **6c — Cleanup and fixes**, the hardening candidates plus the items recorded at the end
  of this spec.

## What the user decided

1. **The case to design for is a new phone or a wiped app.** The backup file is waiting in
   **iCloud Drive**.
2. **Restore merges.** It keeps everything already on the phone and adds everything in the
   backup that is missing. The motivating example: on a new phone, two workouts get logged
   before the restore. Both stay, and the older history fills in behind them.
3. **When the same item is on the phone and in the backup and they differ, the phone's
   copy wins** — except a library exercise the phone has never touched, which loses to the
   backup's copy, so edits like the renamed *Lateral Shuffle* come back on a new phone.
4. **Accepted consequences of merging:** restoring the same file twice changes nothing the
   second time; a workout deleted after a backup comes back if that backup is restored
   onto the same phone; a routine rebuilt on a new phone sits next to the backup's copy
   until one is archived.
5. **Settings come from the backup** (units, default rest, rest sound).
6. **No restore while a workout is in progress.** Finish or discard it first.
7. **Saving goes through the share sheet's Save to Files.** It was proven on the phone, and
   the user found it fine.
8. **A backup counts only when the share sheet reports success.** Backing out does not
   reset the reminder.
9. **The reminder appears on Today 14 days after the last backup** and stays until the
   user backs up — there is no dismiss. The user could lose two to four weeks of workouts
   before it really stung, and 14 days sits inside that.
10. **Settings is reached through a gear (⚙︎) in the top corner of every screen**, not a
    sixth tab. The five tabs stay as they are.
11. **The screens are as mocked**: Settings, the Today reminder, the restore confirmation,
    the two refusal messages and the storage-full message. Each is described below.
12. **Playwright is approved**, including its WebKit browser download and the extra minute
    or two it adds to each deploy.
13. **The user accepted these too, after they were proposed:** a backup taken mid-workout
    includes the workout so far and restores as an unfinished workout; after a restore,
    the reminder counts from when that backup file was made.
14. **A custom exercise recreated on the new phone is the same exercise as the backup's**
    when the name and type match. The backup's history attaches to the phone's copy.
    *Raised by the design review:* a recreated "Explosive Box Step-Up" gets a new id, so
    matching by id alone would split its history in two. "Last time" and PRs would then
    see only the new phone's workouts.
15. **The backup's rotation takes over on a new phone**, even if one was built there first.
    *Raised by the design review:* Today won't start a workout without a rotation, so
    the two workouts in decision 2 imply one was built. "Keep the phone's" would always
    win, and no screen can show an inactive rotation. This replaces the earlier proposal
    that a rotation built on the new phone stays active.

Plan 5's four phone checks passed on 2026-10-20. Two outcomes from them are recorded under
"Recorded for later".

## What the on-device test found

A throwaway page (`public/file-diag.html`, commit `c689547`, since deleted) ran on the
user's iPhone — iOS 18.7, Safari 26.6.1 — in both a Safari tab and an installed home-screen
app. Full results are in `docs/superpowers/spikes/2026-10-20-backup-file-transfer.md`.

| What | Safari tab | Home-screen app |
| --- | --- | --- |
| Share sheet with a `File` (`navigator.share`) | not completed (backed out) | **saved to iCloud Drive** |
| `<a download>` on a blob URL | **saved** | not tried |
| `<input type="file" accept=".json,application/json">` | **opened it** | **opened it** |
| 2 MB file, read back byte for byte | intact | intact |
| `navigator.canShare({ files: [json] })` | true | true |
| `navigator.storage.persisted()` | false | false |
| `navigator.storage.estimate()` quota | 39 GB | 39 GB |

Every opened file matched its SHA-256 and its byte count, with non-ASCII names, escapes,
`22.5`, float noise and millisecond timestamps all intact. Two side findings matter:

- **Quota is effectively unlimited** for this data (about 1 MB a year of training), so
  storage-full is a safety net, not a likely path. **Eviction**, not quota, is the real
  risk, and that is what the backup is for.
- **`display-mode: standalone` was false inside the home-screen app** while
  `navigator.standalone` was true — the test page had no manifest. Anything that needs to
  know it is installed should check `navigator.standalone`. Nothing in this plan does.

## Goals, non-goals, anti-goals

**Goals.** One tap saves everything to iCloud Drive. Restoring that file onto an empty
install reproduces every row exactly. Nothing about backup ever fails silently.

**Non-goals.** Template import (6b). Automatic or cloud backup (v3 in the parent design).
Restoring part of a backup. A replace-everything restore mode. Encryption. The hardening
items (6c). CSS.

**Anti-goals** — things that would make this a failure even if it technically worked:

- **A backup that looks fine and restores wrong.** A dropped field, a converted unit, a
  shifted timestamp, a regenerated id. Each one is silent until the day the backup is
  needed, and there is no recovering from it then.
- **A partly applied restore.** "A partially applied import is worse than a failed one."
- **A restore that damages what is already on the phone.** The user chose merge so that
  nothing on the phone is lost.
- **A reminder that trains the user to ignore it** — one that nags when there is nothing
  new to back up.

## The backup file

### Contents

One JSON document **(my call: JSON — the spike proved it, and it is inspectable by eye)**:

```json
{
  "format": "workout-tracker-backup",
  "formatVersion": 1,
  "exportedAt": 1792551708123,
  "dbVersion": 1,
  "libraryVersion": 2,
  "tables": {
    "exercises": [], "routines": [], "cycles": [], "sessions": [],
    "sets": [], "bodyweight": [], "goals": [], "settings": []
  }
}
```

- **Every row of all eight tables, in full** — including `bodyweight` and `goals`, which
  are empty with no UI. The parent design created them in v1 precisely to keep this format
  stable across the v1 → v2 boundary.
- **Every exercise row, untouched library rows included (my call).** About 650 rows and
  well under 1 MB. The file is then complete on its own: it restores correctly onto a
  build whose library differs, and the merge never has to guess whether an absent bundled
  row was missing or merely untouched.
- **Rows are written exactly as stored.** Weight stays in the unit it was entered in.
  Timestamps stay as millisecond integers. Ids are unchanged, and bundled exercise ids
  stay upstream slugs.
- **Not in the file:** personal records, which are derived and never stored; and the
  rest-timer state, which lives in `localStorage` and is meaningless on another device.

The rows are read in **one read-only transaction across all tables (my call)**, so a
backup taken while something else writes is still a consistent snapshot.

### File name

`workout-backup-YYYY-MM-DD-HHMM.json`, in local time **(my call)**. The date makes each
backup a new file, so a new one never overwrites an old one. Old ones accumulate in iCloud
Drive until the user deletes them.

### The version gate

`formatVersion` is **separate from Dexie's version (my call)**. Dexie's version changes
whenever an index changes, and an index change doesn't alter what a row looks like. The
format version changes only when the shape of a row in the file changes. `dbVersion` and
`libraryVersion` are recorded for diagnosis only.

- **`formatVersion` newer than this build supports** → refused: *made by a newer version
  of the app*.
- **Older** → upgraded in memory, one version step at a time, before validation. Version 1
  is the first, so there are no upgrade steps yet; the mechanism exists so that a file
  exported today restores after future migrations, as the parent design requires.
- **Missing, or `format` is not `"workout-tracker-backup"`** → refused: *not a workout
  backup*.

**A version-1 fixture file is committed to the repo, and a test restores it forever
(my call).** Any later change that breaks restoring a version-1 file fails that test. This
is what holds the parent design's "files exported today restore correctly after future
migrations" promise.

## Backing up

### The flow

1. The user taps **Back up now** — in Settings, in Today's reminder, or in the storage-full
   message. All three call the same code.
2. The app reads the snapshot, builds the file, and calls `navigator.share({ files: [file] })`.
3. The share sheet opens. The user picks Save to Files and saves to iCloud Drive.
4. **When `share()` resolves**, the app records `lastBackupAt = exportedAt`. When it
   rejects with `AbortError` (the user backed out), nothing is recorded and nothing is
   shown. Any other rejection is shown as an error.

### Two fallbacks (my call)

- **The tap expires.** iOS requires `share()` to be called during the user's tap. Building
  the file is asynchronous, and the on-device test built its files ahead of time, so it
  never measured whether the tap survives the build. If `share()` rejects with
  `NotAllowedError`, the button becomes **Save backup file**, holding the already-built
  file. A second tap then opens the sheet. If the tap survives, the user never sees this.
- **No file sharing at all** (`navigator.canShare` missing or false — a desktop browser).
  The app falls back to an `<a download>` link. A download gives no completion signal, so
  in this path `lastBackupAt` is recorded at the click.

### Mid-workout

Backing up is allowed during a workout. The workout in progress goes into the file as it
stands, with its logged sets, and restores as an unfinished workout (user-accepted).

## Restoring

### The flow

1. Settings → **Restore from backup…**. While a workout is in progress the control is
   disabled, with the reason beside it (user decision 6).
2. The Files picker opens (`accept=".json,application/json"`, which the spike proved
   finds the files).
3. The app reads, parses, upgrades and validates the file, then computes the merge. **No
   write happens before the user confirms.**
4. **The confirmation**, as mocked:
   - the file name and when the backup was made;
   - **This adds:** N workouts (M sets), N routines, N custom exercises, your edits to
     N library exercises — each line shown only if its count is non-zero;
   - one line per matched custom exercise, and the rotation line when the backup's
     rotation takes over (both under "The merge rules");
   - "Nothing already on this phone is removed. Settings switch to the backup's: lb, 90 s
     rest, sound on."
   - **Restore** and **Cancel**.
5. **Restore** applies the merge in one read-write transaction across all eight tables.
   The result says what was added. If nothing was missing: *Everything in this backup is
   already on this phone* **(my call)**.

The merge is **recomputed inside the transaction from fresh reads (my call)**, not
replayed from the confirmation screen. If anything changed in between, the transaction
merges against what is actually there. That is the same reasoning as `moveSession`
computing its shift from a fresh read.

### Refusals

Each refusal changes nothing, and says so:

- *This backup can't be restored. It was made by a newer version of the app. Open the app
  while you're online so it updates, then try again. Nothing on this phone was changed.*
- *This isn't a workout backup, or it's damaged. Nothing on this phone was changed.* — with
  the first problem found in small print beneath it **(my call)**, so a bad file can be
  diagnosed without a debugger.

### Validation — before anything is written

A file that fails any check is refused whole. Rows are checked **against this build's
types**:

- Every row has its required fields, with the right types, and values in their enums:
  measurement type, equipment, muscle groups, units, set type, session status and goal
  type.
- Every number is finite. One `NaN` weight would silently switch off PRs for that whole
  exercise, which is why `records.ts` already guards against it.
- **Every timestamp is a plausible date: not before 2000, and not more than a day in the
  future (my call).** This catches the Plan 5 finding that a two-digit year turns `0025`
  into 1925. A goal's `targetDate` is the one exception to the upper bound, since a
  target belongs in the future.
- Ids are unique within each table. The settings row's id is the singleton id.
- **At most one session is in progress.**
- **Referential integrity, checked after the merge**, over the merged result: every set's
  session and exercise exist; every routine item's exercise exists; every cycle's routines
  exist. Checking only the file would wrongly refuse a valid backup whose sets point at
  something already on the phone.

### A backup checks itself (my call)

*Raised by the design review.* Validation at restore time alone finds a bad file only
after the old phone is gone. Two real paths let the app write data these checks reject:

- **`moveSession` accepts any past time**, so a workout can be moved before 2000. The
  `0025` → 1925 bug produces exactly that.
- **`parseSetFields` rejects `NaN` but keeps `Infinity`.** Typing `1e999` produces it,
  and `JSON.stringify` writes it as `null`.

So:

- **Backup and restore share one validator.** **Back up now** runs it on the snapshot
  before saving.
- **If the snapshot fails, the file is still offered and saved.** A backup with one bad row
  beats no backup. The app then says *This backup saved, but it has a problem that would
  stop it restoring:* plus the first problem, with the workout or exercise named, so it
  can be fixed in History or the Library. **`lastBackupAt` is not recorded**, so the
  reminder stays until a clean backup is made.
- **Both known paths are closed at the source.**
  - `parseSetFields` drops a non-finite number exactly as it drops `NaN`. It is the
    single parsing rule, so both edit surfaces change together, as Plan 5 intended.
  - `moveSession` refuses a start before 2000-01-01 with a message, the same bound as the
    validator.
- **The rule for the validator:** it must accept everything the current app can write.
  A check the app's own writes can fail is a bug in one of the two, and the plan settles
  which one before adding the check.

### The merge rules

For each table, rows are matched **by id**. All ids are random UUIDs, except bundled
exercise slugs and the settings singleton, so two different things never share an id.

- **Only in the backup** → added.
- **Only on the phone** → untouched.
- **In both** → **the phone's row wins** (user decision 3), with these exceptions:
  - **An untouched library exercise loses to the backup's row** (user decision 3). The
    phone's row is untouched if it equals this build's bundled entry for that id.
    Equality is field by field, with no particular key order, and **an absent field
    equals an `undefined` one (my call)**.
  - **Settings take the backup's** `unitPreference`, `defaultRestSeconds` and
    `restAlertSound` (user decision 5). **`libraryVersion` stays the phone's (my call)**:
    it records what this build has seeded on this device. **`lastBackupAt` becomes the
    later of the phone's value and the file's `exportedAt`** (user decision 13).
- **A recreated custom exercise** (user decision 14). A custom exercise in the backup
  whose id is not on the phone **matches** a custom exercise on the phone when:
  - the names are equal after trimming, ignoring case; and
  - the measurement types are equal.

  A match is the same exercise. **The phone's row wins** and the backup's row is not added.
  Every backup row that references the backup's id — sets, routine items, goals — is
  **rewritten to the phone's id** before it is added. Phone rows are never rewritten.
  - **Only custom exercises match (my call).** A bundled id is always on both sides, so a
    bundled row never needs a name match. A name shared between a custom exercise and a
    bundled one is left alone.
  - **Different measurement types don't match (my call).** A set logged as weight and
    reps would display wrongly under a timed exercise. Two same-named exercises with
    different types stay separate.
  - **If several phone exercises match (my call)**, an unarchived one is preferred, and
    then the lowest id, so the choice is deterministic.
  - **It is the one place a restore drops an id from the file (my call).** The backup's
    duplicate id has nothing left referring to it. On an empty install nothing can
    match, so the round trip stays exact.
  - **The confirmation names each match:** *Explosive Box Step-Up: history joins the
    copy already on this phone*.
- **The rotation.** After the merge there is exactly one active cycle (user decision 15):
  - **If the backup's active cycle has the same id as the phone's**, they are the same
    rotation and the phone's copy wins, like any other row. This is the case when
    restoring onto the same phone.
  - **Otherwise the backup's active cycle becomes the active one.** The phone's previous
    active cycle is then handled in one of two ways:
    - **If it has no routines**, it is the empty one Today creates on first open, and it
      is **removed** **(my call: an empty cycle holds no information, and removing it keeps
      a restore onto a fresh install identical to the source)**.
    - **Otherwise it is kept but made inactive.** Its routines stay in the Routines list.
      No screen shows an inactive rotation, which is a known gap recorded below. The
      confirmation says so: *Your rotation from the backup replaces the one on this
      phone*.
  - **If the backup has no active cycle**, the phone's stays active.
- **A set whose workout was moved.** A set can be added to a workout the phone already
  has: deleted after the backup, as decision 4 accepted. If the phone's copy of that
  workout has a different `startedAt` than the backup's, it was moved since. The set's
  `completedAt` is then **shifted by the same difference (my call)**, so it lands inside
  its workout. Plan 5's rule is that anything rewriting timestamps keeps sets inside their
  workout. Without the shift, the restored set would corrupt "last time" and PR order.
- **Restoring the same file twice adds nothing the second time.** That follows from
  matching by id.

The merge never deletes or changes a phone row, with three exceptions: an untouched
library exercise, the settings fields above, and the phone's previous active cycle
(removed if empty, otherwise made inactive).

### Where the logic lives (my call)

Parsing, upgrading, validation and the merge plan are **pure functions in `src/domain/`**.
They take the file's contents, the phone's rows and the bundled library. They return
either a refusal, or the rows to add and replace with the counts for the confirmation. A
thin database function reads, merges and writes inside one transaction. The domain stays
I/O-free, every rule is table-testable, and Plan 6b can feed the same apply step rows that
did not come from a backup file.

## The reminder

On Today, above everything else, as mocked: **"Last backup was N days ago."** with a
**Back up now** button. No dismiss (user decision 9).

**When it shows (my call — a refinement of "`lastBackupAt` more than 14 days old", so it
never nags with nothing to back up):**
- at least one **completed** workout started after the last backup, or there has never
  been a backup;
- **and** the last backup is more than 14 days old — or, if there has never been one, the
  earliest such workout started more than 14 days ago.

With no backup yet, the wording is **"You haven't backed up yet."** Exactly 14 days does
not show the reminder; 14 days and 1 ms does.

**A known gap:** editing an old workout after a backup doesn't count as new, because
sessions have no `updatedAt`. Recorded rather than solved.

## Storage full

When any write fails with Dexie's `QuotaExceededError`, the message, as mocked, is:
**"Couldn't save: your phone is out of space for this app. What you typed is still
here. Back up now so nothing is lost."** It comes with a working **Back up now**.

- **Detected in one place, `useWriteError` (my call).** Most writes go through
  `run(...)`. *The design review found two that don't:* `RoutinesScreen` (create and
  archive a routine) and `CustomExerciseForm` (create, edit, archive and reset an
  exercise) catch their own errors. **Both move onto `run(...)` (my call)**, so storage-full
  reaches every write. Their existing keep-what-was-typed behaviour must survive the move.
- **At startup too (my call).** `prepareLibrary` writes on first run and after a library
  update. If it fails today, the app shows only "Could not open the database", and a
  phone that is out of space would then have no way to back up. When that failure is a
  `QuotaExceededError`, the startup screen shows the storage-full message with a working
  **Back up now**. Backing up only reads, so the database being open is enough. Other
  startup failures are unchanged.
- **"What you typed is still here" is the existing rule, not a new one.** A failed write
  never discards input, and that holds for this error as for any other.
- Backing up still works while storage is full. It only reads, and the share sheet writes
  to iCloud Drive. The `lastBackupAt` write may fail, though, and then the file is saved
  but the reminder doesn't reset. That is acceptable, and the error says so.

## The Settings screen — `/settings`

A **⚙︎ in the header of every screen**, with the accessible name "Settings", opens it
(user decision 10). As mocked:

- **Weights** — *Unit for exercises you haven't logged yet*: lb or kg (`unitPreference`).
  Exercises with history keep carrying the unit they were last logged in, as they do now.
- **Rest** — *Default rest between sets*, in whole seconds, at least 1 **(my call: the
  same rule as a routine's own rest)**. A caption says a routine's own rest still wins.
  *Sound when rest ends* is an on/off switch (`restAlertSound`). The rest-timer spec
  deferred it to this plan. **The tone is still silent on the phone** (the parked defect
  in the rest-timer spec), so until 6c fixes it the switch controls a sound that doesn't
  play. The user saw this before approving the screen.
- **Backup** — *Last backup*: the date and "N days ago", or "Never". **Back up now.
  Restore from backup…**
- **Storage** — *Protected from iOS clean-up*: Yes, No, or Unknown, from
  `navigator.storage.persisted()`. A caption: iOS may clear the app's data when the phone
  runs low on space, and backups are the safety net.

**Writes.** This is the first settings writer (`src/db/settings.ts` has only a reader):
- each change saves at once, with no Save button **(my call)**;
- it never passes `id` in an `update()` payload;
- a failed write shows the error and leaves what the user typed in the field.

## The round-trip test

One Playwright test, the parent design's "highest-value test in the suite".

- **WebKit only (my call)** — the engine closest to iOS Safari.
- **Against the production build** under `vite preview`, at `/workout-tracker/` **(my
  call)**. It tests what deploys: the base path, the 404 copy and the service worker.
- **Lives in `e2e/`**, which Vitest's `exclude` must cover.

**The script:**
1. In a first browser context, through the UI:
   - edit a bundled exercise's name;
   - create a custom exercise;
   - build a routine from both and put it in the rotation;
   - start the workout from Today, and log sets covering a lb weight of 22.5, a kg set, a
     warm-up and a timed set;
   - finish.
2. Tap Back up now. `navigator.share` is stubbed by an init script that captures the
   `File` **(my call: so the test runs the same share path the phone uses, not the
   download fallback)**.
3. In a **fresh context**, with empty storage, open the app. The library seeds, and Today
   creates its empty rotation.
4. Settings → Restore, given the captured file through `setInputFiles`, then confirm.

**The comparison.** It must reject a lossy exporter — the handoff's warning: *"A test that
exports then imports and compares row counts passes against an exporter that drops every
timestamp."*

- **Both databases are dumped through the raw IndexedDB API**, never the app's exporter.
  A lossy exporter would agree with itself.
- **Every object store is compared row for row, field for field.** The one exception is
  `settings.lastBackupAt`: the second context is asserted to hold exactly the file's
  `exportedAt`.
- **Non-vacuity assertions:**
  - the dump contains the 22.5 lb set with its exact `completedAt`, the kg set still in kg,
    the custom exercise, and the edited bundled name;
  - the fresh context's original empty cycle is gone, and exactly one cycle is active.

**CI.** `.github/workflows/deploy.yml` gains `npx playwright install --with-deps webkit`
and the e2e run **before** the build, so a broken backup gates the deploy, as the Vitest
suite already does. The workflow's actions are bumped off the deprecated Node 20 runtime
in the same change, as the Plan 6 handoff asked.

## Testing — the wrong implementations each test must reject

Plan 5's reviewers found about twenty tests that could not fail, and most came from the
plan's own test text. **For every test, the plan names the wrong implementation it rejects,
and the reviewer checks that it would.** For this plan, at minimum:

| Wrong implementation | What catches it |
| --- | --- |
| Exporter drops or rounds a field | Field-by-field equality on every table. Fixtures set every optional field to a non-default value, and timestamps have non-round milliseconds. |
| A unit is converted on export or restore | A lb set comes back as lb with the identical number |
| Restore writes some rows, then fails | A failure forced late in the apply leaves every table byte-identical to before |
| Phone-wins inverted | A phone row differing from the backup survives the restore |
| "Untouched" ignored, inverted, or judged by name only | Three fixtures: untouched phone row loses, edited phone row wins, a phone row differing only outside the name still wins |
| Custom-exercise matching missing, too loose or too strict | A same-name, same-type custom exercise gets the backup's sets and routine items rewritten onto the phone's id, and its row is not added. A different type stays separate. Case and surrounding spaces don't block a match. A bundled row is never name-matched. |
| Matching rewrites a phone row instead of the backup's | Every phone row is byte-identical after the restore, apart from the named exceptions |
| Two active cycles after a restore, or the wrong one wins | Same id: the phone's wins. Different id: the backup's becomes active, and the phone's is removed if empty or made inactive if not. Exactly one is active in every case. |
| A re-added set into a moved workout keeps its old time | The set's `completedAt` lands inside the moved workout |
| The version gate is missing or backwards | A newer version is refused, a missing format is refused, the committed version-1 fixture restores |
| Referential integrity is checked against the file only | A backup whose sets point at a phone-only exercise is accepted |
| The reminder rule is off by one, or nags with nothing new | Exactly 14 days vs 14 days and 1 ms; no workouts since the backup; never backed up with no workouts |
| `lastBackupAt` is recorded on a cancel | `AbortError` leaves it unchanged. `NotAllowedError` shows Save backup file. Resolve records `exportedAt`. |
| The backup doesn't check itself, or refuses to save a flawed snapshot | A snapshot with a pre-2000 workout is still saved, shows the warning naming that workout, and leaves `lastBackupAt` unset |
| The validator rejects something the app can write | The committed version-1 fixture is built from rows the app's own write functions produced, and it validates |
| Storage-full is missed on a screen | A forced `QuotaExceededError` on the routines screen, the exercise form and startup each show the message with Back up now |

The Plan 5 test-design rules all apply: no self-sorting order fixtures; no substring text
matches; re-query the live document after an action; and a mandated break for every
absence assertion.

## Inherited constraints that bite here

The full list is in `HANDOFF-2026-10-18-plan-6-backup.md`. The ones this plan is most
likely to trip:

- **Never `.where()` on a boolean or nullable field.** The merge reads whole tables with
  `toArray()` anyway.
- **A querier may not open a readwrite transaction.** Restore and every settings write
  happen in event handlers.
- **One querier per screen**, Settings and the reminder included.
- **Never pass `id` inside an `update()` payload.** The merge's replacements use `put`
  with the full row.
- **Never hard-delete an exercise or routine.** The merge never deletes either. The empty
  cycle it removes is neither, and nothing references it.
- **Bundled ids are upstream slugs, never regenerated.** The restore preserves every id,
  with one exception: a matched custom exercise's duplicate id is dropped, and its
  references are rewritten to the phone's id.
- **Weight is never converted on write.**
- **`run(...)` resolves `true` or `false` and never rejects.**
- **Number inputs inside a `<form>` need `noValidate`.** This applies to the default-rest
  field.
- **Tests are pinned to `America/Chicago`.** The reminder's day arithmetic and the file
  name's local time are both timezone-sensitive.
- **`npx tsc --noEmit` before every commit**, and every test shown failing before it
  counts.

## Recorded for later — not this plan

- **6b, template import:** the apply step above is meant to be reused. The template
  file's name-resolution problem is described in the Plan 6 handoff.
- **6c, cleanup and fixes**, besides the handoff's hardening candidates:
  - **The PR badge's "est. 1RM" wasn't clear to the user** (2026-10-20). Reword it.
  - **One-tap Delete in History can remove two sets on a fast double-tap.** It was
    confirmed on the phone on 2026-10-20, and **the user chose to leave it for now**.
  - **The rest tone fix.** Until it lands, the new sound switch controls a silent tone.
  - **No screen shows an inactive rotation.** A restore can now set one aside (see "The
    rotation" under the merge rules). Its routines survive, but the rotation's order is
    reachable only by rebuilding it in the Rotation tab.

## The phone check before merging

The user's phone is the last gate, as in every plan:

1. **From the home-screen app**, back up and save to iCloud Drive. Settings shows today as
   the last backup.
2. **Open the live site in a Safari tab.** iOS keeps its storage separate from the
   home-screen app's, so the tab is effectively a new phone. Before restoring, play out
   decision 2 there:
   - create the custom exercise "Explosive Box Step-Up", with the same type it has on the
     phone;
   - put it in a routine and that routine in a rotation;
   - log and finish one workout.

   Then restore the file in that tab. These should all hold:
   - every workout, routine and edited exercise from the backup appears;
   - the tab's own workout is still there;
   - there is one Explosive Box Step-Up, holding both histories;
   - the backup's rotation is the active one.
3. **In the home-screen app**, restore the same file. It says everything is already on
   this phone.
4. Back out of the share sheet once, and check that the last backup date doesn't change.

## Left to the builder

- Layout and component structure, within the mocked content.
- Module and function names.
- Wording not quoted above.
- How the in-memory upgrade chain is organised, while there is only version 1.
