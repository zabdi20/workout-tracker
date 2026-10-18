# Handoff — Plan 6: Backup, Restore and Template Import

> **Paste this whole file into a new session to continue.** It is written to be
> self-contained: a cold session should need nothing but this and the repo.

**Repo:** `C:\Users\Hshad\Projects\workout-tracker` · branch `main` · 151 commits · 38 test files / 552 tests
**Live:** <https://zabdi20.github.io/workout-tracker/> (deploys automatically on push to `main`)

---

## What to do first

1. **Ask the user whether the Plan 5 phone checks passed** (see "Outstanding manual checks"). Plan 6 builds an export of everything Plan 5 writes, so a History bug found on the phone changes what the backup has to carry.
2. **Invoke `superpowers:brainstorming`.** Do not start writing code or a plan. Then `superpowers:writing-plans`, then `superpowers:subagent-driven-development`.

The user has been explicit about keeping this discipline: *"I don't want to start bolting features on ad hoc after we've been disciplined this whole way."*

**How the user likes to work, observed across Plan 5:** they said *"just start on Plan 5 — I will step away, so ask questions now."* Ask every scoping question in one batch up front, then run autonomously and **stop before merging**. Their own phone check is the last gate before anything deploys. When a debugging thread stalls forward progress, they would rather park it, fully documented, than chase it.

---

## The project in one paragraph

An offline-first PWA for planning gym workouts and tracking progressive overload, built for one person's iPhone. There is no backend: all data lives in on-device IndexedDB via Dexie. It is installed through Safari's "Add to Home Screen" from GitHub Pages. Development happens on Windows 11, which is why it is a PWA rather than a native app — Xcode is macOS-only. Full design rationale is in `docs/superpowers/specs/2026-08-04-workout-tracker-design.md`. Read it; it records the reasoning behind each decision, not just the decision.

---

## Where the work stands

| Plan | Scope | State |
| --- | --- | --- |
| 1 | Foundation, PWA shell, schema, exercise library, Library screen | **Done, live** |
| 2 | Routines, rotation, Today screen | **Done, live** |
| — | Library revision 2: plyometrics, plus reconciliation | **Done, live** |
| 3 | Active session, prescription UI, editable bundled exercises | **Done, live** |
| 4 | Rest timer, Wake Lock, audible alert | **Done, live** — the tone has an open defect (below) |
| 5 | History browse and edit, PR detection and badges, records per exercise | **Done, live 2026-10-18** |
| 6 | Backup export/import **plus program template import**, Playwright round-trip, hardening | **Next — this handoff** |

**What the app does today.** It logs a workout end to end:
- **Today and routines:** start from Today, log sets across six measurement types with last-time prefill, and finish or discard.
- **Rest:** completing a set starts a timestamp-based rest countdown with Wake Lock.
- **History:** lists finished workouts. Each one can be edited — fix, delete or add sets, change its date and time, or delete the whole workout.
- **PRs:** badged live as a set is logged, and on past workouts.
- **Records:** each weight-and-reps exercise has a records page.

**There is still no CSS.** Visual design was deliberately deferred until the screens settle, and they now largely have.

---

## What Plan 6 must cover

From the design spec — its v1 list, Error handling and Testing sections — and the roadmap:

1. **Backup export and import.** The import is **all-or-nothing, in a single transaction, gated on a schema-version check**: "a partially applied import is worse than a failed one". Backup files **carry a schema version**, so a file exported today restores correctly after future migrations.
2. **Program template import**, which creates routines plus any missing custom exercises. It was folded into this plan on 2026-09-03 because, per `2026-09-03-active-session-design.md`, *"template import and backup restore are the same mechanism aimed at different files, and that plan already owes an all-or-nothing, version-gated, transactional import."*
3. **A backup prompt when `lastBackupAt` is more than 14 days old.**
4. **Quota exceeded surfaces with an export prompt** rather than failing silently.
5. **One Playwright end-to-end round trip:** create routine → log session → finish → export → import into an empty database → verify identical data. The spec calls this *"the highest-value test in the suite; a corrupt backup is the only unrecoverable failure in the app."*
6. **A Settings screen** — the design's screen table lists "Units, default rest, backup export/import". **It also owes the `restAlertSound` toggle**, which the rest-timer spec deferred here.
7. **"Hardening"** — undefined in the roadmap. The strongest candidates are under "Hardening candidates" below.

**Why this matters more than it looks.** iOS reclaims web storage more aggressively than native app storage. The design spec says so explicitly: this *"promotes backup/export from a nice-to-have to a v1 requirement."* Until Plan 6 ships, every logged workout lives in exactly one place, and that place can be evicted.

### Scope check — do this first in the brainstorm

This is the biggest plan yet, and it looks like several projects. **The original Plan 3 hit the same wall:** it accumulated eight items, ran to twice the size of Plans 1 and 2, and was split into Plans 3, 4 and 5. Split here too, and agree an order with the user. One natural cut:

- **6a — Settings plus backup:** export, import, the reminder, the quota prompt, and the Playwright round trip.
- **6b — Template import**, built on 6a's import machinery.
- **6c — Hardening.**

The fold rationale argues template import shares the machinery. It does share the *transactional import*, but it has its own hard problem (see below), and that problem doesn't belong on the backup's critical path.

---

## Questions the brainstorm must settle

**1. Spike file export and import on the actual phone before designing around them.** This is the lesson of the rest tone. The rest-alert spike verified `<audio>` elements and noted that *"the foreground tone was never in question"*. The design then picked Web Audio on that assumption, and it failed on the device. The same trap is waiting here: **how a home-screen PWA on iOS saves a file and reads one back is device-specific, and nobody has tested it.**

Candidates to try:
- an `<a download>` on a blob URL — historically unreliable in standalone mode;
- the Web Share API with a file;
- a `<input type="file">` for import.

A throwaway diagnostic page in `public/`, deployed, run in **both** a Safari tab and the installed app, worked well for the tone. Commit `7d2b859` is the pattern; delete the page afterwards.

**2. How template exercise names resolve to library exercises.** This is template import's real problem. `docs/templates/hypertrophy-4day-upper-lower.md` ends with a "JSON Data (for direct ingestion)" block, and it does not speak the app's vocabulary:
- **Exercise names are free text** — "DB Lateral Raise", "Lateral Bounds (skater jumps)", "Smith Machine Bench Press". The library has 650 entries (`LIBRARY_VERSION` 2) whose ids are upstream `free-exercise-db` slugs.
- **`rep_range` is a string:** `"6-8"`, `"6/side"`, `"8/leg"`, `"20 sec"`. The last is a duration, not reps.
- **`muscle_groups` uses words** ("back", "shoulders", "stability", "power") that are not the app's `MuscleGroup` values.
- **Days have `blocks`**, and the app's routines are flat ordered item lists.

Exact match, fuzzy match, a review screen, or create-custom for anything unmatched is a design decision with real UX cost. The user has already hand-fixed two of these mismatches in the app (see "The training template" below).

**3. What "the same data" means for the round trip.** Weight is stored in its entered unit and never converted, so the backup must not convert either. `completedAt` order drives "last time" and PR order, so timestamps must survive exactly. PRs are derived and never stored, so they must **not** appear in the backup. Bundled exercises the user edited must keep their edits, while a library-reconciliation pass inserts missing ids and leaves present rows alone.

**4. What a backup's schema version is.** It could be Dexie's version — currently `1`, in `db.ts` — or a separate file-format version. That choice determines how the importer handles a file from an older build.

**5. Import semantics.** Is it replace-everything, or merge? What happens with a workout currently in progress? The spec's all-or-nothing rule applies either way.

**6. The Playwright dependency.** It is **not installed**. Adding it means a new dev dependency plus a browser download of roughly several hundred MB, and **downloading needs the user's approval**. CI must install browsers in `.github/workflows/deploy.yml`, and Playwright must serve the app under its `/workout-tracker/` base path. Decide whether WebKit, the closest engine to iOS Safari, is the engine to run.

### What already exists for you

- **`Settings`** (`src/db/types.ts`) already has `lastBackupAt?`, which is unused, and `restAlertSound`, which is read but never written. **`src/db/settings.ts` has `getSettings()` and no writer at all**, so Plan 6 adds the first one.
- **Every table** is defined in `db.ts`: `exercises`, `routines`, `cycles`, `sessions`, `sets`, `bodyweight`, `goals` and `settings`. **`bodyweight` and `goals` are empty with no UI, and the backup must include them anyway.** The spec created them in v1 precisely *"to keep the backup format stable across the v1 → v2 boundary."*
- **`requestPersistentStorage()`** is in `src/pwa/storage.ts`.
- **`prepareLibrary()` and `libraryVersion`** live in `src/db/seed.ts`. They are the library-reconciliation machinery that any import touching exercises must coexist with.
- **`docs/superpowers/HANDOFF-2026-08-11-program-templates.md`** holds the original template-import thinking, including the open "general JSON paste vs a program-template format" question.

---

## Constraints that must not be relearned

Every one of these cost a real bug, and tests enforce them. The first group is carried from earlier plans and is still true.

### Database and queries

- **Never `.where()` on a boolean or nullable field.** `isCustom`, `isArchived`, `isActive` and `Session.routineId` are unindexed. Load them with `toArray()` and filter in memory. **`Session.status` is an indexed string, and `.where('status')` is correct for it.**
- **A `liveQuery` querier may not open a readwrite transaction**, because Dexie throws `ReadOnlyError`. Reads go in the querier, and writes go in event handlers.
- **One querier per screen.** A second `useLiveQuery` lags a render behind and flashes stale UI.
- **Never pass an `id` inside a Dexie `update()` payload.** Dexie turns it into delete-then-add, which is a real hard delete.
- **Never hard-delete an exercise or routine** — archive it instead. `Session` and `LoggedSet` are the deliberate exception.
- **A library revision must be additive.** Edited bundled rows are left alone by reconciliation. **Bundled exercise ids are upstream slugs, never regenerated.** An import must preserve them.

### Data invariants

- **Weight is stored with the unit it was entered in, and never converted.** `distanceMeters` is the canonical exception. Conversion to kg, with `1 lb = 0.45359237`, exists only for PR comparison.
- **`src/domain/` is pure and I/O-free.**
- **Nothing reaches the `sets` table until the user confirms a row.** Planned rows are UI state.
- **The session's exercise list is derived, not stored.** `LoggedSet.order` is a monotonic sort key per (session, exercise); deleting a set leaves a gap on purpose.

### Writes and the UI

- **`run(...)` from `src/ui/useWriteError.ts` never rejects, and now resolves `true` or `false`.** New code uses `if (await run(...))`. Older screens still use the `let wrote = false` idiom; both are correct.
- **A failed write must never discard what the user typed.** That shipped twice in Plan 3, and Plan 5's reviews proved the tests for it can lie (see the next section).
- **GitHub Pages needs `dist/404.html`**, which a Vite `closeBundle` plugin emits, for client-side routes.

### New in Plan 5

- **PRs are derived on demand, never stored** (`src/domain/records.ts`). A backup must not persist them.
- **Moving a workout shifts every one of its sets' `completedAt` in the same transaction** (`moveSession`). It takes an absolute start time, and its double-tap guard depends on that. Anything that rewrites timestamps, an import included, must keep sets inside their workout.
- **Field parsing has one rule, `parseSetFields`**, in `src/domain/measurement.ts`. It is shared by the active workout and History, so the two edit surfaces can't disagree.
- **Number inputs inside a `<form>` need `noValidate`.** A number input's default `step` of 1 makes a real browser refuse 22.5 lb on submit, which jsdom never shows.
- **Tests run pinned to `America/Chicago`** via `test.env.TZ` (`vite.config.ts:83`).
  - CI runs in UTC, where a timezone bug was invisible before the pin.
  - **The pin only works under Vitest's default `forks` pool.** Under `pool: 'threads'` it silently does nothing.
  - A canary test in `src/ui/history/format.test.ts` fails loudly if the pin stops working.
- **`src/testFixtures.ts` is test-only**: `seedExercise`, `seedWorkout`, `T`, `MIN`, `DAY`. It writes `completed` sessions straight to the tables.
- **`LibraryScreen.test.tsx` renders through a `MemoryRouter`**, using its `renderLibrary()` helper. `CustomExerciseForm` and its tests deliberately stay router-free.

---

## Test-design rules Plan 5 paid for — read these before writing the plan

Plan 5's reviewers mutation-tested every task in scratch copies. **They found about twenty tests that could not fail against a plausible wrong implementation — and almost all came from the plan's own test text, not from the implementers.** Each shape below hid a real defect at least once:

- **Ordering fixtures that sort themselves.** Ids like `'new'`/`'old'`, or names like `'Back Squat'`/`'Barbell Bench Press'`, put a fixture alphabetically into the expected order, so removing the sort passed. **Every order assertion needs fixtures where the expected order differs from alphabetical, insertion, chronological and id order.**
- **`toHaveTextContent(string)` is a substring match.** "1 PRs" contains "1 PR". Anchor with a regex such as `/· 1 PR(?!s)/`.
- **Asserting persistence through a stale reference.** An unmounted React subtree is detached intact and keeps its values. A form captured before Save still "held" the typed value after the form had closed. **Re-query from the live document** (`screen.…`) after the action.
- **Absence assertions pass before the code exists.** Every "does not badge" or "leaves unchanged" test needs a mandated break: apply the wrong implementation, watch the test fail, then restore.
- **CI's timezone.** A local-time helper's tests can only fail outside UTC, which is why the zone is pinned now.

**The rule for writing the Plan 6 plan: for every test, name the wrong implementation it must reject, and check that it would.** Backup round-trip tests are especially prone to this. A test that exports then imports and compares row counts passes against an exporter that drops every timestamp.

---

## Environment gotchas

- **Use Git Bash, not PowerShell.** PowerShell's Restricted execution policy blocks the `npm.ps1` shim.
- **After a session resumes, Git Bash can lose `/usr/bin`, so `cat` and `ls` come back "not found".** Restore it with: `export PATH="/usr/bin:/bin:/mingw64/bin:/c/Program Files/nodejs:/c/Program Files/GitHub CLI:$PATH"`. `gh` lives in `/c/Program Files/GitHub CLI`.
- **Git Bash mangles arguments that start with `/`** (MSYS path conversion), and it **does not pass a `TZ` value containing a slash to native Node**. To probe another timezone, set `TZ` from PowerShell.
- **Test commands.** Use `npx vitest run --fileParallelism=false` for a deterministic result; parallel runs are flaky here. The full suite is **38 files / 552 tests** and takes 1.5–3 minutes. To run it the way CI does: `TZ=UTC npx vitest run --fileParallelism=false`.
- **A roughly doubled test count means a git worktree under `.claude/` is being collected.** Treat it as a red flag, not good news.
- **Vitest globals are enabled.** `noUnusedLocals` is on, so an unused import fails `tsc`, and Vitest's transpile-only run won't notice. **Always run `npx tsc --noEmit` before committing.**
- **Use the file-writing tool for docs containing triple backticks.** Heredocs break on them. After editing any plan, check its fence count is even, or the `task-brief` extractor desyncs.
- **The dev server serves under the subpath:** `http://localhost:5173/workout-tracker/`.
- **`.claude/launch.json` is now git-ignored**, which resolves the Plan 4 handoff's open question.
- **`SendMessage` is available in this harness**, so SDD fix rounds can resume the original implementer.
- **The deploy workflow's actions target Node 20** and emit a deprecation annotation. Deploys still succeed. Bump the action versions when CI is next touched — **Plan 6 touches CI if Playwright lands.**

---

## Outstanding manual checks — ask before building on top

**From Plan 5. None confirmed yet; the phone is the only place to check them.**

1. Finish a workout. It appears at the top of History with the right duration, and opening it shows every set.
2. Fix a typo in a past set, and change a past workout's date. The next workout's "last time" line follows both.
3. Log a set heavier than ever for that exercise. It is badged the moment it's logged.
4. Quickly double-tap Delete on a past workout's set. Does it remove two sets? See the open decision below.

**From Plan 4:** the tone at the end of rest **failed** on the phone. The root cause is known, and the fix is designed but parked; see below.

---

## Open decisions waiting on the user

- **One-tap Delete in History.** Plan 5's final review confirmed that a fast double-tap can delete two sets: the next row slides up under the finger, and there is no undo. The active workout's Remove has the same exposure. The spec chose "one tap, no confirmation", and only the code comment was corrected. **Options: a brief lock after each delete, an undo, or leave it.**

---

## Hardening candidates — strongest first

- **The post-deploy reload discards typed-but-unlogged set values mid-workout.** `registerType: 'autoUpdate'` makes vite-plugin-pwa call `window.location.reload()` when a new service worker takes control. The fix is either to defer that reload while a session is in progress, or to switch to `registerType: 'prompt'` with an update banner — which would sit naturally on the new Settings screen. This is the same "a failed write must never discard what the user typed" class that shipped twice in Plan 3. **The user deprioritized it but did not drop it.**
- **The silent rest tone.** Root cause, designed fix and device verification steps are all in the "Open defect" section of `docs/superpowers/specs/2026-09-05-rest-timer-design.md`. In short: the audio unlock is a module-level `AudioContext` created only by the Log-set tap, so any reload or backgrounding between that tap and zero leaves the tone silent. The fix: re-arm on any tap, rebuild a non-running context inside the gesture, and allow a bounded resume at zero. It also shares a cause with the item above, since the post-deploy reload kills the unlock. **The user deprioritized it.**
- **The rest timer dies on in-app navigation**, and the History tab makes that easy to reach. It lives inside `ActiveSessionScreen`, so switching tabs mid-rest stops it, and leaving `/session` also drops unlogged rows. Both are documented in the rest-timer and Plan 5 specs. Hoisting the hook above the router's `<Outlet />` fixes the timer.
- **`ActiveSessionScreen.tsx` is 446 lines.** Two whole-branch reviews have called it a split candidate. Whichever of the items above lands first will be in this file anyway.

---

## Known open items, deferred deliberately

Plan 5's final review triaged 39 Minor findings as deferrable. Its ledger was git-ignored and has been deleted, as the process requires. The ones most likely to matter to Plan 6:

- **Error alerts sit at the top of the page** on History's screens. A failed save lower down a long workout looks like a no-op on a phone, and the alert lingers after Cancel.
- **`fromDateTimeLocalValue` turns year `0025` into 1925**, via the `Date` constructor's 0–99 mapping. iOS's wheel picker can't produce that year, but an imported or typed value could. **Validate dates on import.**
- **Inside the repeated hour at the autumn clock change, an edited time is ambiguous.** Typing 01:45 for a workout at the later 01:30 parses as the earlier 01:45. This is inherent to `datetime-local`.
- **`deleteCompletedSession` on a missing id is a silent no-op.** That was accepted on the merits, but nothing pins it.
- **From Plan 4, still open:**
  - `RestTimerRecord.restSeconds` is written but never read;
  - nothing asserts the wake-lock wiring;
  - a few `not.toThrow()` assertions are near-vacuous;
  - `RestBanner` nests a `<button>` in a `<p>`, which matters once CSS lands.

---

## Process notes that earned their keep

- **Pre-flight scan the plan against the real files** — every helper, fixture and render harness it quotes. Plan 5's scan caught that `LibraryScreen.test.tsx` and `CustomExerciseForm.test.tsx` render with no router, which would have crashed fifteen tests. Plan 3's scan would have caught five of its eight defects.
- **When a ruling establishes a pattern, grep the remaining tasks for it immediately.** Plan 5 found four more coincidentally-ordered tests in later tasks this way, before they ran.
- **Write plans as signatures plus exact tests, not function bodies.** All four of Plan 4's defects lived in plan-supplied code; Plan 5's plan carried almost none. The defects moved into the plan's *test fixtures* instead — hence the test-design rules above.
- **Reviewers who mutation-test in a scratch copy outside the repo** were the single most valuable seat. They proved defects instead of asserting them, and they repeatedly re-derived numbers such as tick counts, timestamps and badge arithmetic rather than trusting reports.
- **Give reviewers the diff as a file** via `scripts/review-package`, and give implementers their task via `scripts/task-brief`. Both live in the `subagent-driven-development` skill directory. **Never tell a reviewer what not to flag.**
- **The ledger survives interruptions.** Plan 5 was cut off by a usage limit mid-plan, then resumed cleanly from the ledger's "PAUSED — resume at Task 6" marker plus `git log`.
- **Every ruling made while the user is away goes in the final message**, with what it costs if wrong. Every spec decision the user didn't make is marked **(my call)** in the spec.

---

## The training template, for context

`docs/templates/hypertrophy-4day-upper-lower.md` is the user's real program. It is a four-day upper/lower hypertrophy split with a power/agility block on each lower day. The user plays basketball and soccer, so lower-body lifting volume was trimmed in favour of explosiveness and landing control. It is also the first file template import will meet, so treat it as the acceptance test for that half of Plan 6.

**The user has already made two of the template's entries match the app by hand.** They created `Explosive Box Step-Up` as a custom exercise, because the upstream library has none. They renamed and retyped the bundled `Side to Side Box Shuffle` to a timed `Lateral Shuffle`. That is the name-resolution problem, solved manually twice. An importer has to do the same thing, or ask.

The template also encodes progression rules: double progression, RIR 1–3, and deload triggers. The spec puts suggested progression at **v3**, and the user explicitly chose "just show me last time" over app-driven progression. **Import the routines; treat the progression rules as documentation** unless the user says otherwise.
