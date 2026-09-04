# Handoff — Plan 4: Rest Timer

> **Paste this whole file into a new session to continue.** It is written to be
> self-contained: a cold session should need nothing but this and the repo.

**Repo:** `C:\Users\Hshad\Projects\workout-tracker` · branch `main` · 112 commits · 355 tests
**Live:** <https://zabdi20.github.io/workout-tracker/> (deploys automatically on push to `main`)

---

## What to do first

**Invoke `superpowers:brainstorming` before anything else.** Do not start writing code
or a plan.

Plan 4 is small and well-bounded — items 2 and 3 of the original v1 spine, nothing
folded in. The brainstorm is short, but it is not skippable, because the real question
is a design one the spike already constrains: *what does a timer look like when it
cannot make a sound in the background, and returning to it late is the normal case
rather than the edge case?*

Then `superpowers:writing-plans`, then `superpowers:subagent-driven-development`.

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
| — | Library revision 2: plyometrics + reconciliation | **Done, live** |
| 3 | Active session, prescription UI, editable bundled exercises | **Done, merged 2026-09-04** |
| 4 | Rest timer, Wake Lock, audible alert | **Next — this handoff** |
| 5 | History browse and edit, PR detection and badges | Not started |
| 6 | Backup export/import **plus program template import**, Playwright round-trip, hardening | Not started |

**The plan numbering changed on 2026-09-03.** The original Plan 3 had accumulated eight
items and was roughly twice the size of Plans 1 or 2. It was split into 3 / 4 / 5, and
program template import was folded into the backup plan — the two are the same mechanism
pointed at different files, and the backup plan already owes an all-or-nothing,
version-gated, transactional import. Rationale in
`docs/superpowers/specs/2026-09-03-active-session-design.md`.

**What the app does today:** everything Plans 1–2 did, plus **it can log a workout**.
Start from Today (or pick a different routine), log sets across all six measurement
types with last-time prefill, add an exercise mid-session, finish (which advances the
rotation) or discard. Routines carry `4 × 6–8` prescriptions and a per-item rest value.
Bundled exercises are editable, with Reset to bundled.

**It still has no CSS at all.** It works and it is plain. Visual design is deliberately
deferred until the screens settle — which, after Plan 4, they largely will have.

---

## What Plan 4 must cover

1. **Rest timer** — timestamp-based, Screen Wake Lock, re-acquisition on
   `visibilitychange`.
2. **Audible rest alert** while the document is visible, silenceable via the existing
   `Settings.restAlertSound` field.

That is the whole scope. Resist adding to it.

### What already exists for you

Plan 3 deliberately shipped the timer's inputs so that Plan 4 has no schema or data work
to do:

- **`RoutineItem.restSeconds`** is editable in the routine editor and **already displayed
  on the session screen** — `ActiveSessionScreen.tsx` renders `Rest 2:00` from
  `item?.restSeconds ?? settings.defaultRestSeconds`. Find that line; the timer replaces
  or augments it.
- **`getSettings()`** in `src/db/settings.ts` returns the singleton merged over defaults,
  including `defaultRestSeconds` (90) and `restAlertSound` (true). It is read-only and
  safe inside a `useLiveQuery`.
- **`formatDuration(seconds)`** in `src/domain/measurement.ts` renders `m:ss` and is
  already tested. Reuse it rather than writing a second one.
- **The confirm tap** is the single place a set is written — `confirmSet` in
  `ActiveSessionScreen.tsx`. That is where "completing a set auto-starts the rest timer"
  hooks in, and it already has a success flag (`wrote`) so you can start the timer only
  when the set actually persisted.

### The layout question the split deferred

Plan 3's spec accepted one cost knowingly: **the timer arrives into a session screen that
was not designed around it.** The mitigation was that `restSeconds` ships and displays, so
the value the timer consumes already exists and is visible. Whether that mitigation was
enough is now testable rather than theoretical — look at the screen and judge.

Two whole-branch reviewers flagged `ActiveSessionScreen.tsx` (~400 lines, five interaction
modes in one render body) as cohesive but a split candidate, and both said **Plan 4 is the
natural forcing function**: the spec frames the timer as "a banner over a set list", so
extracting `PlannedSetRow` (the field loop, warm-up toggle and confirm button, ~60 lines)
and `LoggedSetList` gives the banner somewhere to sit. Consider that extraction part of
Plan 4's scope rather than a separate cleanup.

---

## The rest-timer finding, so it is not re-litigated

A spike (`docs/superpowers/spikes/2026-08-04-rest-alert-reach.md`) established that
**background alerting is impossible for a PWA on iOS.** Timers and audio are both
suspended when backgrounded, regardless of audio session category and regardless of
whether the app is installed. Measured on iOS 18.7: an installed app advanced its audio
clock 5.5 s over 58 s away.

Three approaches were tried and all fail: a silent looping keepalive plus a JS-timed tone
(a 30 s timer fired at 81 s, on resume); a single pre-rendered track with the beep baked
in, needing no JavaScript at fire time (the audio clock itself is suspended, which rules
out the whole class of workaround); and the `playback` audio session category (it seizes
the audio session and still does not play backgrounded — it costs the user their music
and buys nothing).

**Consequences that are design inputs, not caveats:**

- The timer must be **timestamp-based**, recomputing from a stored deadline. A 30 s
  `setInterval` was measured firing at 81 s.
- **Returning to the app after rest has elapsed is a normal flow.** The UI must make
  elapsed rest obvious on resume — not just show 0:00.
- **Wake Lock is released whenever the document becomes hidden** and is *not* restored
  automatically. Re-acquire on `visibilitychange`.
- Web Push is rejected: it requires a server, reinstating the backend this design removes,
  and live network in a gym basement.

One untested idea remains, recorded in the spec's Deferred section:
`shortcuts://run-shortcut` is a public URL scheme, so a hand-made Shortcut could start a
*native* Clock timer, which fires on a locked screen because it is iOS's own. Costs a
manual setup step and an app-switch per set. If it works it ships as an **optional**
setting, never the default.

---

## Constraints that must not be relearned

Every one of these cost a real bug. They are enforced by tests; breaking them will fail
review.

- **Never `.where()` on a boolean or nullable field.** `isCustom`, `isArchived`,
  `isActive` and `Session.routineId` are deliberately unindexed — IndexedDB cannot key
  booleans or `null`, and `.where()` on them throws at runtime. Load with `toArray()` and
  filter in memory. A regression test in `src/db/db.test.ts` pins this.
  **`Session.status` is a string and IS indexed** — `.where('status').equals('in_progress')`
  is correct. Do not over-apply the rule.
- **A `liveQuery` querier may not open a readwrite transaction** — Dexie throws
  `ReadOnlyError`. Reads go in the querier; writes go in event handlers. `/session`
  deliberately creates nothing; Today starts the session and `/session` redirects when
  none is in progress.
- **One querier per screen.** Splitting a read into a second `useLiveQuery` makes it lag a
  render behind the first, flashing stale UI on every change. All three screens carry a
  comment saying so.
- **`run(...)` from `src/ui/useWriteError.ts` catches internally and never rejects.** That
  is deliberate, so callers can render the message — but it means **execution continues
  after a failed write**. To know whether a write succeeded, set a local flag inside the
  closure: `let wrote = false; await run(async () => { ...; wrote = true; }); if (wrote) …`.
  This idiom appears four times in the codebase. **A failed write must never discard what
  the user typed** — that exact bug shipped twice in Plan 3 and was fixed twice.
- **`src/domain/` is pure and I/O-free.** Type-only imports from `src/db/types` are fine;
  a runtime database import is not.
- **Weight is stored with the unit it was entered in and never converted.** 135 lb stays
  exactly `135` + `'lb'`. Round-tripping through kg produces drift that eventually renders
  as a fake PR. `distanceMeters` is the deliberate exception — canonical metres.
- **Never pass an `id` inside a Dexie `update()` payload.** Dexie turns it into
  delete-then-add under the new key — a real hard delete. `updateExercise` and `updateSet`
  both strip it.
- **Never hard-delete an exercise or routine** — archive via `isArchived`. `Session` and
  `LoggedSet` are the deliberate exception: nothing references a session except its own
  sets, which is why `discardSession` deletes both in one transaction.
- **Nothing reaches the `sets` table until the user confirms a row.** Planned rows are UI
  state, not `LoggedSet` rows. This is what keeps PR detection, volume, history and the
  backup format from ever filtering out sets that were not performed. `confirmSet` also
  guards a wholly blank row — confirming an untouched row writes nothing.
- **Focus is identity-based, not positional** — the same lesson the rotation pointer
  taught. The session's exercise list grows when one is added mid-session; an index would
  silently point at a different movement.
- **The session's exercise list is derived, not stored:** routine items in order, then any
  exercise with logged sets, then any added this session. Adding an exercise writes
  nothing.
- **`LoggedSet.order` is a monotonic sort key per (session, exercise), not a position.**
  Deleting a set leaves a gap on purpose; display numbering is the position in the sorted
  array. `logSet` computes it inside the write transaction from a fresh read, so two fast
  taps cannot both claim the same order.
- **Prefer `updateRoutineItems(id, mutator)` over `setRoutineItems(id, array)` from UI
  handlers.** A handler computing the next array from one captured at render works from
  stale input the moment a second tap lands. `setRoutineItems` remains for test fixtures.
- **A library revision must be additive.** Reconciliation inserts missing ids and touches
  nothing present. Bundled entries are now editable, and an edited row is one
  reconciliation leaves alone — `resetExerciseToBundled` is the escape hatch, and it
  deliberately does **not** restore `isArchived`.
- **Bundled exercise ids are upstream `free-exercise-db` slugs**, never regenerated.
- **GitHub Pages needs `dist/404.html`** for client-side routes; the build emits it via a
  Vite `closeBundle` plugin. A static `public/404.html` does not work.

---

## Environment gotchas

- **Use Git Bash, not PowerShell.** PowerShell's default Restricted execution policy
  blocks the `npm.ps1` / `npx.ps1` shims. If `node` is missing from PATH:
  `export PATH="/c/Program Files/nodejs:$PATH"`.
- **`npm test` in parallel is flaky in this sandbox.** Use
  `npx vitest run --fileParallelism=false` for a deterministic result. A full run takes
  about 50 seconds and should report **25 files / 355 tests**.
- **If the suite ever reports roughly double that, you have a worktree.** A git worktree
  under `.claude/` holds a full copy of `src/`, and Vitest was collecting every test file
  twice — 710 across 50 files. `vite.config.ts` now excludes `**/.claude/**` and
  `.gitignore` ignores `.claude/worktrees`. A doubled pass count reads as good news while
  hiding a real failure; treat it as a red flag, not a bonus.
- **`.claude/launch.json` is untracked and unignored.** Decide whether it should be
  committed; it currently shows in `git status` on every run.
- Node v24.19.0, npm 11.17.0. Installed majors are newer than much documentation assumes:
  **Vite 8, Vitest 4, TypeScript 7, React 19, Dexie 4.4, jsdom 30, react-router-dom 7.18**.
- **Vitest globals are enabled.** Tests do not import `describe`/`it`/`expect`/`beforeEach`.
- **After editing any plan document, check that its count of lines beginning with a triple
  backtick is even.** An unbalanced fence desyncs the `task-brief` extractor's fence
  tracking and silently swallows every following task into one brief.
- **Writing docs containing triple backticks via a Bash heredoc will break.** Use the
  file-writing tool for those.
- **The dev server serves under the subpath.** `http://localhost:5173/workout-tracker/`.
- **The deploy workflow emits a Node 20 deprecation annotation.** Deploys succeed. Bump
  the action versions when something else touches CI.

---

## Outstanding manual checks — not yet done

These could not be verified from this machine and **no unit test can cover them**, because
Vitest forces `base` to `/`. A regression here passes CI and only breaks the deploy.

1. **Cold-load `https://zabdi20.github.io/workout-tracker/session` directly** on the phone.
   It must reach the app and redirect to Today, not GitHub's 404 page.
2. **Start a session, log a set, background Safari for a few minutes, reopen.** The logged
   set survives and the remaining planned rows resume where they were.

Ask the user whether these passed before building on top of them.

---

## Process notes that earned their keep

Plan 3 ran the subagent-driven loop across 8 tasks with 3 fix rounds plus one whole-branch
fix wave. **Every defect found during execution originated in the plan text, not in an
implementation** — implementers pushed back eight times and were right eight times.

- **Give reviewers the diff as a file** via `scripts/review-package BASE HEAD`, and give
  implementers their task via `scripts/task-brief PLAN N`. Both live in the
  `subagent-driven-development` skill directory.
- **Never tell a reviewer what not to flag** or pre-rate a finding's severity. On Plan 3
  a reviewer was handed the facts about a wrong premise but deliberately *not* the
  controller's opinion, and independently reached the same conclusion — which is worth
  more than agreement obtained by suggestion.
- **Verify a test can fail.** Plan 3 shipped four tests that could not: a concurrency test
  that awaited sequentially, an error-path test that passed against unfixed code, a test
  asserting an ordering property that was never broken, and a dead clamp two tests claimed
  to pin. Ask implementers to revert the fix and show the failure.
- **A pre-flight scan of the plan against the real files pays for itself.** Five of Plan
  3's eight defects were the plan quoting helpers, imports and fixtures it had never
  checked existed. A mechanical grep of every helper name the plan quotes would have caught
  them before dispatch.
- **When a ruling establishes a *pattern* fix rather than a point fix, grep the branch for
  the pattern immediately.** Plan 3's controller fixed draft-loss-on-failed-write in one
  file and missed the identical shape in another, which only the whole-branch review found.
- **Progress ledger:** `.superpowers/sdd/2026-09-03-active-session/progress.md`
  (git-ignored, local only). 389 lines: every task with its commit range, all 17 rulings
  with what each costs if wrong, and 25 deferred Minor findings with triage verdicts.
  **Read it** — it is the most detailed record of what went wrong and why. Plan 2's
  equivalent is at `.superpowers/sdd/progress.md`.

---

## Known open items, deferred deliberately

All 25 are in the ledger with a triage verdict from the whole-branch review. The ones most
likely to matter to Plan 4 or 5:

- **`finishSession` has no already-completed guard.** Re-finishing re-stamps `endedAt`.
  Harmless today because `advanceAfter` re-anchors rather than increments — but it becomes
  a history-corrupting bug the moment **Plan 5's History screen can call it on a past
  session.** Fix it when you build History.
- **`lastPerformance` selects the previous session by walking `[exerciseId+completedAt]`
  descending.** Two sets written in the same millisecond make that selection arbitrary,
  because ties break on primary key. Unreachable in a gym; trivially hit in tests, which is
  why one fixture now stamps explicit `completedAt` values. Documented in the function's
  JSDoc.
- **`ActiveSessionScreen.tsx` is ~400 lines** with five interaction modes in one render
  body. See "The layout question" above — Plan 4 is the forcing function.
- **`finish()` and `discard()` are identical five-line blocks**, the third and fourth
  occurrence of the `let done = false` idiom. A `runThenNavigate(fn)` helper is the right
  move at the fifth occurrence — the timer may well be it.
- **Today's "Do a different one" picker renders while a session is in progress.** The spec
  puts it in the `Otherwise` branch beside Start. As built, opening it mid-session and
  picking a routine produces an honest "already in progress" error rather than a silent
  failure, and a passing test pins that behaviour. Recorded as an accepted deviation — a
  controller ruling that is worth a second opinion.
- **Archived exercises in routines are marked but not blocked.** `RoutineEditor` and the
  session screen both render `(archived)`; logging against one is still permitted, since
  the user may have archived it by mistake and is standing at the machine.
- **Visible-label / accessible-name mismatches (WCAG 2.5.3)** in the session screen: a
  label reads "Weight (lb)" while the accessible name is "Weight for set 1", and a button
  reads "Remove" while its name is "Remove planned set 3". Both are correct choices for
  now; the visible text should absorb the row number when the CSS pass lands.
- From Plan 2, still open: `archiveRoutine`'s atomicity is untested; `RoutinesScreen`
  hand-rolls its own error state instead of using `useWriteError`.

---

## The training template, for context

`docs/templates/hypertrophy-4day-upper-lower.md` is the user's real program — a 4-day
upper/lower hypertrophy split with a power/agility block on each lower day (they play
basketball and soccer, so lower-body lifting volume was trimmed in favour of explosiveness
and landing control).

Plan 3 delivered what the template needed structurally: per-item prescriptions
(`4 × 6–8`, rest) and editable bundled exercises, so `Side to Side Box Shuffle` can be
renamed to `Lateral Shuffle` and retyped as a timed drill to match `4 × 20 sec`.

**Two things the user must still do by hand, in the app:**

- **Create `Explosive Box Step-Up` as a custom exercise.** It is absent from the upstream
  source under any filter. `Single Leg Push-off` is the nearest bundled match.
- **Retype and rename `Side to Side Box Shuffle`** via Library → tap it → change
  measurement type to Duration and the name to `Lateral Shuffle`.

The template also encodes progression rules (double progression, RIR 1–3, deload
triggers). The spec puts suggested progression at **v3**, and the user explicitly chose
"just show me last time" over app-driven progression during the original brainstorm. Treat
those rules as documentation the user reads, unless they say otherwise.
