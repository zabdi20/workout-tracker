# Handoff — Program Template Support (proposed Plan 2.5)

> **Paste this whole file into a new session to continue.** It is written to be
> self-contained: a cold session should need nothing but this and the repo.

**Repo:** `C:\Users\Hshad\Projects\workout-tracker` · branch `main` · 73 commits · 208 tests
**Live:** <https://zabdi20.github.io/workout-tracker/> (deploys automatically on push to `main`)

---

## What to do first

**Invoke `superpowers:brainstorming` before anything else.** Do not start writing code
or a plan. The work below is described as a proposal, not a decision — scope it properly
first, the way Plans 1 and 2 were scoped. Then `superpowers:writing-plans`, then
`superpowers:subagent-driven-development`.

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

The spec scopes v1 as four plans. **Plans 1 and 2 are complete, reviewed, and deployed.**

| Plan | Scope | State |
| --- | --- | --- |
| 1 | Foundation, PWA shell, schema, 587-exercise library, Library screen | **Done, live** |
| 2 | Routines, rotation, Today screen | **Done, live** |
| 3 | Active session: set logging, rest timer, history, PR detection | Not started |
| 4 | Backup export/import, Playwright round-trip, hardening | Not started |

Plan documents: `docs/superpowers/plans/`. Both were amended repeatedly during
execution as bugs surfaced, so they now read as current specifications rather than
historical records.

**What the app does today:** browse/search/filter 587 exercises, create custom
exercises, build named routines with ordered exercises, order routines into a rotation,
and see what is next on the Today screen. It has no CSS at all — it works and it is
plain. Visual design is deliberately deferred until the screens settle.

**What it cannot do:** log a set. There is deliberately no Start button on Today —
sessions are Plan 3, and a button that starts nothing would be a stub.

---

## Why this handoff exists

The user supplied a real training program — `docs/templates/hypertrophy-4day-upper-lower.md`,
a 4-day upper/lower hypertrophy split with a power/agility block on each lower day
(they play basketball and soccer, so lower-body lifting volume was trimmed in favour of
explosiveness and landing control).

They asked for it to be built into the app. **It cannot be, and finding out why exposed
three real gaps.**

### Gap 1 — routines cannot hold a prescription

A routine today is a *named, ordered list of exercises*. Nothing more.

`RoutineItem` already carries `restSeconds`, `targetSets`, `targetRepMin` and
`targetRepMax` in the schema — added deliberately in Plan 1 as forward-compatibility
hooks — but **none of them have any UI**. So `4 × 6–8, 2–3 min rest` has nowhere to
live. Entering this template by hand today captures maybe a third of its value.

Plan 3 wants these fields anyway: "last time: 135×8" is far more useful displayed
against "target 6–8".

### Gap 2 — the exercise library excludes the entire plyometrics category

Verified against the vendored source and the built library:

- 23 of the template's 28 exercises map cleanly to existing library entries.
- 5 are missing: **Lateral Bounds, Explosive Box Step-Up, Broad Jump, Lateral Shuffle,
  Single-Leg Hop & Stick** — every one of them from the power/agility blocks.

The cause is in `src/data/mapping.ts`. `shouldInclude` keeps only
`strength`, `powerlifting`, and `olympic weightlifting`, which drops all **61
plyometrics** entries in `vendor/free-exercise-db.json`. That source contains
`Lateral Bound`, `Standing Long Jump` (a broad jump), `Single-Leg Lateral Hop`,
`Side to Side Box Shuffle` and more — all excluded.

**Complication:** most plyometrics entries have `equipment: "other"` or `null`, and
`shouldInclude` also drops anything whose equipment maps to `other`. So widening the
category filter alone is not enough; the equipment handling needs a decision for that
category (map to `bodyweight`? allow `other` for plyometrics only?).

Also note `measurementType` inference: several are time-based (`Lateral Shuffle` is
`4 × 20 sec`), and the current `inferMeasurementType` would label them `bodyweight_reps`.

### Gap 3 — no import path

Data lives in IndexedDB on the phone. There is no way to get a program in except
tapping it out: 4 routines × 7 exercises, plus creating the missing customs. Roughly
20 minutes of thumbing, repeated for every future program change.

---

## Proposed scope (to be validated in brainstorming, not assumed)

Three pieces, in dependency order:

1. **Widen the library build** to include plyometrics, resolving the equipment and
   `measurementType` questions above. Regenerating `src/data/exercises.json` changes the
   bundled library on an already-seeded device — see `Settings.libraryVersion` below.
2. **Surface `targetSets` / rep range / `restSeconds`** in the routine editor.
3. **Template import** — paste JSON, get routines plus any missing custom exercises.

Points 1 and 2 are largely work Plan 3 would need regardless, so this is mostly pulling
work forward rather than adding it. Point 3 is arguably the seed of Plan 4's restore
path and should be weighed against just building Plan 4's import properly.

**Open questions for brainstorming:**

- Is this a Plan 2.5, or does it fold into Plan 3?
- Should import be a general JSON paste, or specifically a program-template format?
- The template also encodes progression rules (double progression, RIR 1–3, deload
  triggers). The spec puts suggested progression at **v3** and the user explicitly chose
  "just show me last time" over app-driven progression during the original brainstorm.
  Does importing a template change that decision, or do the progression rules stay
  documentation the user reads?
- `Settings.libraryVersion` exists precisely so a corrected bundled library can be
  reconciled onto a device that seeded an earlier revision — but **the reconciliation
  logic was deliberately never written**. Widening the library forces that question.

---

## Constraints that must not be relearned

Every one of these cost a real bug. They are enforced by tests; breaking them will fail
review.

- **Never `.where()` on a boolean or nullable field.** The Dexie schema deliberately
  leaves `isCustom`, `isArchived`, `isActive` and `Session.routineId` unindexed —
  IndexedDB cannot key booleans or `null`, and `.where()` on them throws at runtime.
  Load with `toArray()` and filter in memory. A regression test in `src/db/db.test.ts`
  pins this by asserting those names are absent from `schema.idxByName`.
- **A `liveQuery` querier may not open a readwrite transaction** — Dexie throws
  `ReadOnlyError`. `getOrCreateActiveCycle` always opens one, deliberately, to stay
  race-safe under StrictMode's double-invoked effects. Read through the read-only
  `getActiveCycle()` inside `useLiveQuery`; create from a mount effect.
- **`src/domain/` is pure and I/O-free.** Type-only imports from `src/db/types` are
  fine; a runtime database import is not.
- **Every database write from an event handler surfaces its failure** via `run(...)`
  from `src/ui/useWriteError.ts`. A bare `onClick={() => save(...)}` is fire-and-forget:
  on rejection the user sees nothing while the app looks like it worked.
- **Never hard-delete** an exercise or routine — archive via `isArchived`. A delete
  orphans referencing rows. Note `updateExercise` strips `id` from its changes, because
  Dexie turns an `id` in the update payload into delete-then-add under the new key.
- **Weight is stored with the unit it was entered in and never converted.** 135 lb stays
  exactly `135` + `'lb'`. Round-tripping through kg produces drift that eventually
  renders as a fake PR.
- **Bundled exercise ids are upstream `free-exercise-db` slugs**, never regenerated.
  `LoggedSet.exerciseId` references them; rebuilding with fresh ids would orphan every
  logged set on a seeded device. **This directly constrains Gap 1's fix.**
- **The rotation pointer is identity-based, not positional.** Editing the rotation must
  never silently change what you are about to train.
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
- Node v24.19.0, npm 11.17.0. Installed majors are newer than much documentation
  assumes: **Vite 8, Vitest 4, TypeScript 7, React 19, Dexie 4.4, jsdom 30,
  react-router-dom 7.18**.
- **After editing any plan document, check `grep -c '^```' <plan>` is even.** An
  unbalanced fence desyncs the `task-brief` extractor's fence tracking, which silently
  swallows every following task into one brief. This happened once and produced a
  1616-line brief instead of 414.

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

---

## Known open items, deferred deliberately

From the Plan 2 final review, triaged as "accept" rather than fix:

- `archiveRoutine`'s atomicity is untested — forcing a mid-transaction abort needs a
  Dexie mock; the nesting semantics were verified by inspection instead.
- Rapid double-clicks on reorder/remove recompute from a stale captured array, so a
  second fast tap can be silently absorbed.
- Vitest forces `base` to `/`, so no unit test can distinguish
  `basename={import.meta.env.BASE_URL}` from a hardcoded `/`. A regression there passes
  CI and only breaks the deploy — it belongs on a manual post-deploy checklist.
- `CustomExerciseForm.handleArchive` is still fire-and-forget; it predates
  `useWriteError` and was never retrofitted.
- `RoutinesScreen` hand-rolls its own error state instead of using `useWriteError`.

Also flagged for whenever Plan 3 is drafted:

- Archived exercises stay silently in routines and are visually indistinguishable from
  active ones. `RoutineEditor` and `TodayScreen` use `includeArchived: true` so names
  still render, but nothing warns the user.
- Nothing enforces "exactly one active cycle". It holds by construction today because
  only one is ever created.

---

## The rest-timer finding, so it is not re-litigated

A spike (`docs/superpowers/spikes/2026-08-04-rest-alert-reach.md`) established that
**background alerting is impossible for a PWA on iOS.** Timers and audio are both
suspended when backgrounded, regardless of audio session category and regardless of
whether the app is installed. Measured on iOS 18.7: an installed app advanced its audio
clock 5.5 s over 58 s away.

Plan 3's rest timer therefore ships **foreground tone plus Wake Lock only**, and must be
timestamp-based — a 30 s `setInterval` was measured firing at 81 s.

One untested idea remains, recorded in the spec's Deferred section: `shortcuts://run-shortcut`
is a public URL scheme, so a hand-made Shortcut could start a *native* Clock timer,
which fires on a locked screen because it is iOS's own. Costs a manual setup step and an
app-switch per set.
