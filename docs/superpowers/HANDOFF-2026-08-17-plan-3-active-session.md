# Handoff — Plan 3: Active Session

> **Paste this whole file into a new session to continue.** It is written to be
> self-contained: a cold session should need nothing but this and the repo.

**Repo:** `C:\Users\Hshad\Projects\workout-tracker` · branch `main` · 76 commits · 224 tests
**Live:** <https://zabdi20.github.io/workout-tracker/> (deploys automatically on push to `main`)

---

## What to do first

**Invoke `superpowers:brainstorming` before anything else.** Do not start writing code
or a plan.

The first question is **not** how to build Plan 3. It is whether Plan 3 should still be
one plan. It has absorbed two features since the spec was written and is now roughly
twice what Plans 1 and 2 each were. Scope it before planning it. Then
`superpowers:writing-plans`, then `superpowers:subagent-driven-development`.

The user has been explicit about wanting this discipline kept: *"I don't want to start
bolting features on ad hoc after we've been disciplined this whole way."*

---

## The project in one paragraph

An offline-first PWA for planning gym workouts and tracking progressive overload, built
for one person's iPhone. No backend — all data lives in on-device IndexedDB via Dexie.
Installed via Safari "Add to Home Screen" from GitHub Pages. Development happens on
Windows 11, which is why it is a PWA and not a native app: Xcode is macOS-only, so
native SwiftUI and an Apple Watch companion were never available.

Full design rationale: `docs/superpowers/specs/2026-08-04-workout-tracker-design.md`.
Read it. It records decisions and, more usefully, the reasoning behind them.

---

## Where the work stands

| Plan | Scope | State |
| --- | --- | --- |
| 1 | Foundation, PWA shell, schema, exercise library, Library screen | **Done, live** |
| 2 | Routines, rotation, Today screen | **Done, live** |
| — | Library revision 2: plyometrics + reconciliation (2026-08-17) | **Done, live** |
| 3 | Active session, rest timer, history, PRs — **plus two folded-in items** | Not started |
| 4 | Backup export/import, Playwright round-trip, hardening | Not started |

Plan documents: `docs/superpowers/plans/`. Both were amended repeatedly during
execution as bugs surfaced, so they now read as current specifications rather than
historical records.

**What the app does today:** browse/search/filter 650 exercises, create and edit custom
exercises, build named routines with ordered exercises, order routines into a rotation,
and see what is next on the Today screen. It has no CSS at all — it works and it is
plain. Visual design is deliberately deferred until the screens settle.

**What it cannot do:** log a set. There is deliberately no Start button on Today — a
button that starts nothing would be a stub.

---

## What Plan 3 must now cover

From the spec's v1 spine:

1. **Active session logging** across all six measurement types, with last-time reference
   and prefill.
2. **Rest timer** — timestamp-based, Screen Wake Lock, re-acquisition on
   `visibilitychange`.
3. **Audible rest alert** while the document is visible, silenceable via
   `restAlertSound`.
4. **History** — browse sessions by date, and edit past ones.
5. **PR detection and badges.**

Folded in on 2026-08-17 (see the Resolution in
`HANDOFF-2026-08-11-program-templates.md`):

6. **Per-item prescription UI** — `targetSets`, `targetRepMin`/`targetRepMax`,
   `restSeconds` on `RoutineItem`. The fields have existed in the schema since Plan 1
   with no UI. They were folded here because their reader lives here: a target is worth
   showing next to "last time: 135×8", and worth nothing on its own.
7. **Program template import** — paste a program, get routines plus any missing custom
   exercises.

Discovered while shipping revision 2:

8. **`measurementType` correctable on bundled exercises.** About ten plyometrics
   entries are timed drills rather than rep sets — including `Side to Side Box Shuffle`,
   the library's match for the training template's `Lateral Shuffle 4 × 20 sec`. There
   is no way to fix that today.

   This one is **much smaller than it sounds**. `CustomExerciseForm` already renders a
   `measurementType` select and already accepts an `existing` exercise, and
   `updateExercise` already permits the field. The only gate is `LibraryScreen`'s
   `onSelect={(e) => e.isCustom && setEditing(e)}`, which refuses to open bundled
   entries. Decide what editing a bundled exercise means — and note `updateExercise`
   deliberately strips `id` and `isCustom` for reasons documented in the file.

---

## The scope problem — read before planning

Items 1–8 are not one plan. For calibration: Plan 1 was 10 tasks and Plan 2 was 9, and
each delivered roughly one of the numbered items above.

**A proposed split, to be validated in brainstorming rather than assumed:**

- **3a — Active Session.** Set logging across the six measurement types, prefill from
  last time, autosave, add/remove sets mid-workout, warm-up flagging. Plus item 6, the
  prescription UI: it is a Routines-screen edit, but its whole justification is what
  Active Session displays, and splitting the two means building a writer with no reader
  again.
- **3b — Rest timer.** Items 2 and 3. Independently sized, and it carries platform
  constraints nothing else shares (see the rest-timer finding below).
- **3c — History and PRs.** Items 4 and 5. PR detection is a pure `domain/` function
  over data 3a produces, so it cannot start earlier anyway.
- **Fold item 7 into Plan 4.** Template import and backup restore are the same mechanism
  pointed at different files, and Plan 4 already owes an all-or-nothing, version-gated,
  transactional import. Building a second import path first risks shipping the weaker
  one and keeping it. The 2026-08-11 handoff reached this same conclusion
  independently.
- **Item 8 rides along** with whichever plan next touches the Library screen. It is one
  gate condition and a decision about scope of edit.

The strongest argument against splitting: 3a and 3b share the session screen, and a
timer bolted on afterwards may not fit the layout it was not designed into. Weigh that
in brainstorming — it is the real trade-off, not a formality.

---

## What shipped on 2026-08-17, and why it matters here

Library revision 2 widened the bundled library from 587 to 650 entries: the whole
plyometrics category, plus a new `medicine_ball` member on the `Equipment` union which
also admitted two previously-dropped strength entries.

Two consequences Plan 3 inherits:

- **`equipment: 'other'` now appears in real data** (31 entries) where it previously
  matched nothing. Any UI that switches on equipment must handle it.
- **Reconciliation now exists and runs at startup.** `prepareLibrary` in
  `src/db/seed.ts` replaced `seedExercisesIfEmpty`; seeding a new device and upgrading
  an old one are one operation — insert every bundled row whose id is absent, then
  stamp `Settings.libraryVersion`. **Any future library revision must stay additive**,
  because correcting the *contents* of an existing row is explicitly unsolved: it would
  silently overwrite a user's own edit. See "Library revisions" in the design spec.

---

## Constraints that must not be relearned

Every one of these cost a real bug. They are enforced by tests; breaking them will fail
review.

- **Never `.where()` on a boolean or nullable field.** The Dexie schema deliberately
  leaves `isCustom`, `isArchived`, `isActive` and `Session.routineId` unindexed —
  IndexedDB cannot key booleans or `null`, and `.where()` on them throws at runtime.
  Load with `toArray()` and filter in memory. A regression test in `src/db/db.test.ts`
  pins this by asserting those names are absent from `schema.idxByName`.
  **This directly constrains Plan 3:** `Session.routineId` is nullable, and sets are
  queried by the compound `[exerciseId+completedAt]` index, not by anything boolean.
- **A `liveQuery` querier may not open a readwrite transaction** — Dexie throws
  `ReadOnlyError`. `getOrCreateActiveCycle` always opens one, deliberately, to stay
  race-safe under StrictMode's double-invoked effects. Read through the read-only
  `getActiveCycle()` inside `useLiveQuery`; create from a mount effect. Expect this to
  bite again the moment a session is created on screen entry.
- **`src/domain/` is pure and I/O-free.** Type-only imports from `src/db/types` are
  fine; a runtime database import is not. PR detection and estimated 1RM belong here.
- **Every database write from an event handler surfaces its failure** via `run(...)`
  from `src/ui/useWriteError.ts`. A bare `onClick={() => save(...)}` is fire-and-forget:
  on rejection the user sees nothing while the app looks like it worked.
- **Never hard-delete** an exercise or routine — archive via `isArchived`. A delete
  orphans referencing rows. Note `updateExercise` strips `id` from its changes, because
  Dexie turns an `id` in the update payload into delete-then-add under the new key.
- **Weight is stored with the unit it was entered in and never converted.** 135 lb stays
  exactly `135` + `'lb'`. Round-tripping through kg produces drift that eventually
  renders as a fake PR. `distanceMeters` is the deliberate exception — canonical metres,
  because distance has no exact-recall requirement.
- **Bundled exercise ids are upstream `free-exercise-db` slugs**, never regenerated.
  `LoggedSet.exerciseId` references them; rebuilding with fresh ids would orphan every
  logged set on a seeded device.
- **A library revision must be additive.** Reconciliation inserts missing ids and
  touches nothing that already exists. That is what preserves archived and hand-edited
  rows.
- **Plyometrics is the one category that keeps unmappable equipment.** In
  `shouldInclude`, `other` is allowed for plyometrics and rejected everywhere else, and
  `inferMeasurementType` takes plyometrics from the category rather than the equipment.
  Both halves of the asymmetry are pinned by tests — it is not an oversight to tidy up.
- **The rotation pointer is identity-based, not positional.** Editing the rotation must
  never silently change what you are about to train. Completing a session must advance
  it via `advanceAfter`.
- **GitHub Pages needs `dist/404.html`** for client-side routes; the build emits it via
  a Vite `closeBundle` plugin. A static `public/404.html` does not work — Vite copies
  `public/` verbatim, so it would reference no hashed asset names.

---

## Environment gotchas

- **Use Git Bash, not PowerShell.** PowerShell's default Restricted execution policy
  blocks the `npm.ps1` / `npx.ps1` shims. If `node` is missing from PATH:
  `export PATH="/c/Program Files/nodejs:$PATH"`.
- **`npm test` in parallel is flaky in this sandbox** from timeouts that pre-exist on
  bare `main`. Use `npx vitest run --fileParallelism=false` for a deterministic result.
  A full run takes about 45 seconds.
- Node v24.19.0, npm 11.17.0. Installed majors are newer than much documentation
  assumes: **Vite 8, Vitest 4, TypeScript 7, React 19, Dexie 4.4, jsdom 30,
  react-router-dom 7.18**.
- **After editing any plan document, check that its count of lines beginning with a
  triple backtick is even.** An unbalanced fence desyncs the `task-brief` extractor's
  fence tracking, which silently swallows every following task into one brief. This
  happened once and produced a 1616-line brief instead of 414.
- **Writing docs containing triple backticks via a Bash heredoc will break.** Use the
  file-writing tool for those. This document cost one failed attempt to learn.
- **The dev server serves under the subpath.** `http://localhost:5173/workout-tracker/`,
  not the root — `base` is `/workout-tracker/` to match Pages.
- **The deploy workflow emits a Node 20 deprecation annotation** (`actions/checkout@v4`,
  `setup-node@v4`, `configure-pages@v5`, `upload-artifact@v4` forced onto Node 24).
  Deploys succeed. Unrelated to any feature work; bump the action versions when
  something else touches CI.

---

## Process notes that earned their keep

The subagent-driven loop caught **eleven real bugs across the two plans, every one of
them originally in the plan rather than the implementation.** Worth preserving:

- **Give reviewers the diff as a file** via `scripts/review-package BASE HEAD`, and give
  implementers their task via `scripts/task-brief PLAN N`. Both live in the
  `subagent-driven-development` skill directory.
- **Never tell a reviewer what not to flag** or pre-rate a finding's severity.
- **Ask implementers to stress-test.** Two races and a deterministic `ReadOnlyError`
  were found only because implementers ran files repeatedly beyond what was asked.
- **Take an implementer's pushback seriously.** Four times in Plan 2 an implementer
  refused to accept the controller's arithmetic or premise and was right every time —
  including refusing to fabricate a RED phase for a test that could not fail.
- **Progress ledger:** `.superpowers/sdd/progress.md` (git-ignored, local only). It
  records every task with its commit range, every bug caught, and the open Minor
  findings deferred from the final reviews. **Read it** — it is the most detailed record
  of what went wrong and why.
- **Verify an intermediate commit before relying on it.** Revision 2 shipped as two
  commits; the first was checked standalone by stashing the second, so the branch
  bisects. Cheap, and it catches a plan that ordered its tasks wrongly.
- **Measure claims about the data before designing around them.** The 2026-08-11
  handoff's estimate of the plyometrics gap was close but wrong in both directions —
  the equipment fix admitted two extra strength entries nobody predicted, and one of
  the five "missing" exercises turned out not to exist upstream at all. A five-minute
  script over `vendor/free-exercise-db.json` settled it.

---

## Known open items, deferred deliberately

From the Plan 2 final review, triaged as "accept" rather than fix:

- `archiveRoutine`'s atomicity is untested — forcing a mid-transaction abort needs a
  Dexie mock; the nesting semantics were verified by inspection instead.
- Rapid double-clicks on reorder/remove recompute from a stale captured array, so a
  second fast tap can be silently absorbed. **Worth revisiting in Plan 3** — the same
  pattern in a set-logging list would lose a logged set, which is far worse than losing
  a reorder.
- Vitest forces `base` to `/`, so no unit test can distinguish
  `basename={import.meta.env.BASE_URL}` from a hardcoded `/`. A regression there passes
  CI and only breaks the deploy — it belongs on a manual post-deploy checklist.
- `CustomExerciseForm.handleArchive` is still fire-and-forget; it predates
  `useWriteError` and was never retrofitted.
- `RoutinesScreen` hand-rolls its own error state instead of using `useWriteError`.

Flagged for Plan 3 specifically:

- **Archived exercises stay silently in routines** and are visually indistinguishable
  from active ones. `RoutineEditor` and `TodayScreen` use `includeArchived: true` so
  names still render, but nothing warns the user. A session started from such a routine
  will happily log sets against an archived exercise.
- **Nothing enforces "exactly one active cycle".** It holds by construction today
  because only one is ever created.
- **`Session.name` is snapshotted from the routine** at creation so renaming later does
  not rewrite history. Easy to forget and expensive to retrofit.

---

## The rest-timer finding, so it is not re-litigated

A spike (`docs/superpowers/spikes/2026-08-04-rest-alert-reach.md`) established that
**background alerting is impossible for a PWA on iOS.** Timers and audio are both
suspended when backgrounded, regardless of audio session category and regardless of
whether the app is installed. Measured on iOS 18.7: an installed app advanced its audio
clock 5.5 s over 58 s away.

Plan 3's rest timer therefore ships **foreground tone plus Wake Lock only**, and must be
timestamp-based — a 30 s `setInterval` was measured firing at 81 s. Returning to the app
after rest has elapsed is a normal flow, not an edge case: the UI must make elapsed rest
obvious on resume and recompute from a stored deadline.

One untested idea remains, recorded in the spec's Deferred section:
`shortcuts://run-shortcut` is a public URL scheme, so a hand-made Shortcut could start a
*native* Clock timer, which fires on a locked screen because it is iOS's own. Costs a
manual setup step and an app-switch per set.

---

## The training template, for context

`docs/templates/hypertrophy-4day-upper-lower.md` is the user's real program — a 4-day
upper/lower hypertrophy split with a power/agility block on each lower day (they play
basketball and soccer, so lower-body lifting volume was trimmed in favour of
explosiveness and landing control). It is what motivated items 6, 7 and 8.

Two things it still needs that revision 2 did not deliver:

- **`Explosive Box Step-Up` must be created as a custom exercise.** It is absent from
  the upstream source under any filter. `Single Leg Push-off` is the nearest bundled
  match.
- **`Lateral Shuffle` is prescribed as `4 × 20 sec`** but maps to a bundled entry typed
  `bodyweight_reps`. That is item 8.

The template also encodes progression rules (double progression, RIR 1–3, deload
triggers). The spec puts suggested progression at **v3**, and the user explicitly chose
"just show me last time" over app-driven progression during the original brainstorm.
Treat those rules as documentation the user reads, unless they say otherwise.
