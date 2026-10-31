# Handoff — Plan 6b: Program Template Import

> **Paste this whole file into a new session to continue.** It is written to be
> self-contained: a cold session should need nothing but this and the repo.

**Repo:** `C:\Users\Hshad\Projects\workout-tracker`
**Live:** <https://zabdi20.github.io/workout-tracker/> (deploys automatically on push to `main`)

---

## What to do first

1. **Ask the user whether the Plan 6a phone check passed and whether 6a is merged.** On 2026-10-31, 6a was finished and reviewed on branch `plan-6a-backup`. Its worktree is `.claude/worktrees/plan-6a-backup`, holding 18 commits on top of `main` at `51eb17a`, this handoff included. It was deliberately **not merged**, because the user's phone check is the last gate. The steps are in the 6a spec's "The phone check before merging", plus the extras listed under "Phone check" below.
   - Local `main` is 2 commits ahead of `origin/main`: the 6a plan, `562b578` and `51eb17a`. Nothing has been pushed since the spec.
   - **The first deploy of 6a is also the first real run of the new Playwright CI step**, on Linux WebKit. If it fails, the deploy is skipped and the live site stays on the old build. The run uploads `test-results/` as the `playwright-test-results` artifact, kept 7 days, with a trace and screenshots.
2. **Invoke `superpowers:brainstorming`.** Do not start with code or a plan. Then use `superpowers:writing-plans`, then `superpowers:subagent-driven-development`.

The user's words: *"I don't want to start bolting features on ad hoc after we've been disciplined this whole way."*

**How the user likes to work:** ask every scoping question in one batch up front, then run autonomously and **stop before merging**. They read a recommendation and often say "do your recommendation". They may say "pause after this review", or step away with "continue and stop when you're done". A usage limit can cut a session off mid-plan, and the SDD ledger's resume marker carried 6a across one cleanly.

---

## Where the work stands

| Plan | Scope | State |
| --- | --- | --- |
| 1–5 | Foundation, routines and rotation, active session, rest timer, History and PRs | **Done, live** |
| 6a | Backup and restore, Settings, reminder, storage-full prompt, WebKit round trip gating the deploy | **Done on `plan-6a-backup`, awaiting the phone check** |
| 6b | **Program template import** | **Next — this handoff** |
| 6c | Cleanup and hardening | After 6b (list below) |

The test count on the 6a branch is 48 Vitest files / 780 tests, plus 1 Playwright WebKit test (`npm run test:e2e`). Run Vitest with `npx vitest run --fileParallelism=false`. Parallel runs are flaky on this machine.

---

## What 6a built that 6b reuses

The spec is `docs/superpowers/specs/2026-10-20-backup-and-restore-design.md`, and the plan is `docs/superpowers/plans/2026-10-29-backup-and-restore.md`.

- **`src/domain/backupMerge.ts`:** `planMerge(phone, backup, bundled)` returns `{ ok, plan: { put, deleteCycleIds, summary } }`. Matching is by id, and the phone wins.
  - Custom exercises match on trimmed, lower-cased name plus measurement type, unarchived first. References inside backup rows are rewritten to the phone's id.
  - The backup's active rotation takes over. The phone's previous one is deleted if empty, otherwise made inactive.
  - `addsNothing(plan)` reads the plan's rows, not the counts. That is deliberate: a counts-only check skipped real writes.
  - **The plan's `put` shares row objects with the input file.** Clone first if 6b mutates them.
- **`src/db/backup.ts`:**
  - `previewRestore(text)` writes nothing and returns `refused` or `ready { file, summary, nothingToAdd }`.
  - `applyRestore(file)` plans the merge again **inside** one rw transaction over every table, from fresh reads. It writes settings last and throws on a refusal, which writes nothing.
  - **Template import's natural path:** build a `BackupFile`-shaped set of tables from the template (routines, plus any missing custom exercises), then reuse the same preview → confirm → apply flow.
  - **Never await a foreign promise inside a Dexie transaction:** it commits early.
- **`src/domain/backupValidate.ts`:** `validateTables`, `checkReferences` and `EARLIEST_PLAUSIBLE_TIME`. A template's rows should pass the same validator before anything is written.
- **`src/ui/settings/RestoreControl.tsx`:** the file picker (`accept=".json,application/json"`, proven on the phone), the refusal copy, and the confirmation list ("This adds: …"). A template import screen can follow its shape.
- **`src/ui/WriteErrorAlert.tsx` and `run` from `src/ui/useWriteError.ts`:** every write goes through `run`, which never rejects. Storage-full shows a working Back up now button.

---

## 6b's real problem: name resolution

`docs/templates/hypertrophy-4day-upper-lower.md` is the user's real program, and it is the acceptance test for 6b. It ends with a "JSON Data (for direct ingestion)" block that does not speak the app's vocabulary:

- **Exercise names are free text**, such as "DB Lateral Raise", "Lateral Bounds (skater jumps)" and "Smith Machine Bench Press". The library has 650 entries (`LIBRARY_VERSION` 2), whose ids are upstream `free-exercise-db` slugs.
- **`rep_range` is a string:** `"6-8"`, `"6/side"`, `"8/leg"` or `"20 sec"`. The last one is a duration, not reps.
- **`muscle_groups` uses words** ("back", "shoulders", "stability", "power") that aren't the app's `MuscleGroup` values.
- **Days have `blocks`**, while the app's routines are flat ordered item lists.

**The user has already solved two of these by hand.**
- They created `Explosive Box Step-Up` as a custom exercise.
- They renamed and retyped the bundled `Side to Side Box Shuffle` to a timed `Lateral Shuffle`.

An importer has to do the same, or ask. The options are exact match, fuzzy match, a review screen, or create-custom for anything unmatched, and each has real UX cost. That is the brainstorming question.

The template also encodes progression rules: double progression, RIR 1–3, and deload triggers. The user chose "just show me last time" over app-driven progression. **Import the routines and treat the progression rules as documentation**, unless the user says otherwise.

The original template-import thinking is in `docs/superpowers/HANDOFF-2026-08-11-program-templates.md`. It includes the open question of a general JSON paste versus a program-template format.

---

## Phone check for 6a (if not yet done)

These are the spec's four steps, plus what the final review asked to be watched:

1. **Backing up from the home-screen app** must show "Backup saved.", and Settings must show today.
   - This is the first time the validator sees real data written by older builds. A 1925 workout from the `0025` date bug, or a non-numeric weight, would show "has a problem" instead.
   - If that happens, fix the named row in History, then back up again.
   - Note whether the first tap opens the share sheet directly or shows "Save backup file". If "Save backup file" never succeeds, report it, because that path has no other way out.
2. **In a Safari tab**, which acts as a new phone, read the confirmation before tapping Restore.
   - "your edits to N library exercises" should match what was actually edited.
   - Expect "Explosive Box Step-Up: history joins the copy already on this phone" and "Your rotation from the backup replaces the one on this phone".
   - After restoring, check that Today offers the backup's next routine, History shows both sets of workouts, and the Step-Up's history includes both. The tab's own routine should still be under Routines.
3. **Restoring into the home-screen app** must say "Everything in this backup is already on this phone." with no Restore button. If a "This adds:" confirmation appears instead, **tap Cancel and report it.** Restoring is a merge, so it cannot be undone.
4. **Backing out of the share sheet** once must show no message and must not change the date.
5. **Extras:**
   - Set rest to 75 and leave the field. Watch for a one-frame flash of the old value.
   - Storage should read "No".
   - The gear should be present on every screen.
   - The reminder sits above the "Today" heading. That follows the spec's "above everything else"; moving it under the heading is one line.

---

## 6c — cleanup and hardening, strongest first

**From the 6a spec's "Recorded for later":**
- **"est. 1RM" on the PR badge** wasn't clear to the user. Reword it.
- **History's one-tap Delete can remove two sets on a fast double-tap.** The user chose to leave it for now.
- **The silent rest tone.** Its root cause and fix are in `docs/superpowers/specs/2026-09-05-rest-timer-design.md`. Until it lands, the new sound switch controls a silent tone.
- **No screen shows an inactive rotation**, and a restore can now set one aside.

**From the earlier hardening list, still open:**
- **The post-deploy auto-update reload discards typed-but-unlogged set values mid-workout.** Defer the reload during a session, or switch to `registerType: 'prompt'` with a banner on Settings.
- **The rest timer dies on in-app navigation.** Hoist it above the router `<Outlet />`.
- **`ActiveSessionScreen.tsx`** is a split candidate.

**From 6a's final review (triaged as 6c):**
- **A hand-crafted backup can make the merge shift a set decades into the future.** The shift for a set joining a phone workout is unbounded. Refuse it as `damaged`, or validate `put` before writing.
- **A future library revision that corrects existing rows** would be reverted on restore and miscounted as "your edits". This does not apply today, because revisions are additive. The file's `libraryVersion` can tell the cases apart. Handle it in whichever plan first corrects library rows.
- **A bundled exercise whose type changed on the old phone** re-reads the new phone's sets under the new type, and they show "—". Nothing is lost.
- **Restoring a backup whose only news is goals, weigh-ins or a rotation swap** shows an empty list. Add a fallback line.
- **The reminder never counts a workout that was in progress during a backup and finished after it**, because the rule is start-based, like the spec's recorded edit gap.
- **Tests to add:**
  - the `now + DAY` validator grace boundaries;
  - `updateSettings`'s transaction, pinned with a `Promise.all`;
  - BackupButton's second-tap error, cancel and expiry branches;
  - a recorded backup clearing Today's reminder;
  - the pre-6a stale-node assertions in `ActiveSessionScreen.test.tsx` and `RoutineEditor.test.tsx`.
- **Polish:**
  - the comment at `SettingsScreen.tsx` around the rest guard describes an Infinity path the input can't reach;
  - `deploy.yml`'s artifact upload uses a broad `if: failure()`;
  - CI downloads WebKit on every run (optional caching).

---

## Rulings made during 6a, while the user was away

Each ruling is listed with what it costs if it was wrong. The user should read these.

1. **R1:** Task 8 used Task 7's querier name (`data.inProgress`). If wrong: nothing, since it is naming only.
2. **Validator reference-check order** follows the table order, then the declared field, rather than the brief's message list. If wrong: only a row with two broken references would notice.
3. **Moving a workout before 2000 throws, even on a no-op save of a legacy pre-2000 workout.** If wrong: one confusing message. The UI skips unchanged saves anyway.
4. **The phone's own inactive copy of the backup's active rotation is made active**, keeping phone-wins on content. If wrong: nothing in the normal case.
5. **R2: "already on this phone" reads the merge plan's rows, not the counts.** If wrong: an interface change in two tasks. The counts-only version would have silently skipped real writes.
6. **Matched exercise names are de-duplicated.** If wrong: nothing.
7. **Backing up from Today's reminder makes the reminder vanish before "Backup saved." shows.** The disappearance is the confirmation. If wrong: a missing "saved" line on Today.
8. **"days ago" clamps at 0**, so a backup dated slightly ahead reads "today". If wrong: nothing.
9. **The reminder sits above the "Today" heading**, plus an extra test row for the 14-day boundary. If wrong: a one-line move.
10. **The workflow was validated offline,** because the action-validator CLI was blocked here. If wrong: a CI syntax failure on the merge, in which case the deploy simply doesn't run.
11. **The final fix wave also took two cheap guards:**
    - the rest field accepts only safe integers of at least 1;
    - a test checks that the bundled library passes the backup validator.

    If wrong: one small extra diff.
12. **The SDD workspace (`.superpowers/sdd/2026-10-29-backup-and-restore/`, git-ignored) was kept until the phone check passes**, rather than deleted at the end of the final review, in case the check needs another fix round. Delete it after the merge. If wrong: a stale folder.

**Plan rulings, recorded in the 6a plan:**
- "Everything already on this phone" is decided at preview, and nothing is written, settings included.
- The e2e test runs after the build in CI, still before the upload.

---

## Process notes that earned their keep in 6a

- **The pre-flight scan's producer → consumer table** caught the one cross-task naming gap (R1) before Task 1 ran.
- **Ask for pre-review fixes when an implementer's concern is a real defect.** Doing this produced R2 and the "days ago" clamp. It is cheaper than a full review round.
- **Have reviewers check absence assertions.** A test that a removed implementation still passes asserts nothing. Several of these turned up and were fixed in 6a.
- **Re-query the live document after an action.** React detaches an unmounted subtree intact, so a captured node still shows the typed value even after the row has remounted.
- **Run the e2e locally on Windows WebKit.** A fresh context takes about 10 s to seed the library, so the first wait has a 60 s timeout.
