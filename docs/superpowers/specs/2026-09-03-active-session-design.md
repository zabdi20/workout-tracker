# Active Session — Design Spec

**Date:** 2026-09-03
**Status:** Approved for planning
**Scope:** Plan 3 only

This is an addendum to `2026-08-04-workout-tracker-design.md`, which remains
authoritative for the app as a whole. It records the decisions made when the original
Plan 3 was scoped, and it supersedes nothing — where the two overlap, this document is
the more specific one.

## Why this exists

The original Plan 3 accumulated eight items: session logging, rest timer, audible
alert, history, PR detection, per-item prescription, program template import, and a
correction to `measurementType` on bundled exercises. Plan 1 shipped 10 tasks and
Plan 2 shipped 9, and each delivered roughly *one* of those eight. Planning all eight
together would have doubled the largest unit of work the project has completed.

## The split

Three plans replace the original Plan 3.

| Plan | Scope | Items |
| --- | --- | --- |
| **3** | Active session logging, prescription UI, bundled-exercise correction | 1, 6, 8 |
| **4** | Rest timer, Wake Lock, audible alert | 2, 3 |
| **5** | History browse and edit, PR detection and badges | 4, 5 |

Program template import (item 7) folds into the backup plan. Template import and
backup restore are the same mechanism aimed at different files, and that plan already
owes an all-or-nothing, version-gated, transactional import. Building a second import
path first risks shipping the weaker one and keeping it.

The measurement-type correction (item 8) rides with Plan 3 rather than with whatever
next touches the Library, because it blocks logging the user's actual program:
`Side to Side Box Shuffle` is typed `bodyweight_reps`, while the training template
prescribes `Lateral Shuffle 4 × 20 sec`.

**The cost of splitting, accepted knowingly:** the rest timer arrives in Plan 4 into a
session screen that was not designed around it. The mitigation is that the timer is a
banner over a set list, not a restructuring of one, and that Plan 3 ships
`RoutineItem.restSeconds` and displays it — so the value the timer consumes already
exists and is already visible when the timer is built.

## Decisions

### One session in progress at a time

At most one session may be `in_progress`. Today shows **Resume** in place of Start
while one exists, and it must be finished or discarded before another starts.

Safari killing the tab mid-workout and the user walking away for four days become the
same code path, which is the point. Discarding is an explicit button on the session
screen, never automatic — an app that silently decides something about training data
is worse than one that asks.

### Prefill comes from last time's matching set

"Last time" is the most recent **completed** session containing that exercise,
regardless of which routine it came from — the same exercise may appear in several
routines. It never includes the session currently in progress.

Planned row *N* prefills from last time's working set *N*, falling back to its final
set when last time had fewer. This preserves last week's ramp: 135, 135, 145 means 145
is waiting on set 3, which is the progressive-overload case the app exists to serve.

Warm-up sets appear in the reference line but are excluded from the working-set
comparison, consistent with their exclusion from PR and volume calculations.

Prefill is a *reference*, not a target. The target is the prescription
(`targetSets`, `targetRepMin`, `targetRepMax`), which is a separate reading on screen.

### Planned rows are UI state, not database rows

The set list shows a row per planned set — `targetSets`, else last time's working-set
count, else 1 — each prefilled and unconfirmed. **Nothing is written to IndexedDB
until a row is confirmed.** A `LoggedSet` is created by the confirm tap.

Resume re-derives the unconfirmed rows: load the session's logged sets, subtract them
from the prescription, render the remainder. The rows are derived, so re-deriving them
costs nothing.

The gap this leaves is a number typed into a row that was never confirmed. Not a set —
a keystroke. On resume the row shows its derived prefill again and the user retypes one
number.

Two alternatives were considered and rejected:

- **Planned rows as real rows with a `pending` flag.** The Dexie migration is genuinely
  cheap, since an optional field needs no backfill. The cost is permanent: every
  consumer of `sets` must filter pending rows forever — PR detection, volume, history,
  the backup format, and every feature not yet written. A filter bug there produces a
  **fake PR**, which is the exact failure mode the never-convert-weight rule exists to
  prevent. A permanent tax to save a keystroke is the wrong trade.
- **Draft state as a blob on `Session`.** Loses nothing and keeps `LoggedSet` clean, but
  it is a second representation of set data that can drift from the first. Drift between
  two copies of the same numbers is another way to manufacture a fake PR.

The chosen model also collapses the write surface to a single point — the confirm tap —
which is where the concurrency guard belongs. One guarded write beats a guard per row.

Draft persistence remains a strict add-on: if the lost keystroke ever becomes annoying
in practice, it can be added without touching anything built here.

### Deviation from the routine is supported

Two forms:

- **Add any exercise mid-session.** The squat rack is occupied; log something else.
  Reuses `ExerciseBrowser`, already extracted in Plan 2.
- **Start a routine other than the one up next.** This finally gives `advanceAfter`'s
  re-anchoring rule a caller — the code has existed since Plan 2 with nothing
  exercising it in practice.

Freestyle sessions (`routineId: null`) stay schema-only. No entry point, no UI.

### Bundled exercises become fully editable

Tapping any exercise in the Library opens the same form custom exercises use — name,
muscles, equipment, measurement type — plus **Reset to bundled**, shown only for
bundled entries. The row keeps `isCustom: false`.

Renaming is the point, not a side effect: `Side to Side Box Shuffle` → `Lateral Shuffle`
makes the library match the training template.

Reconciliation already leaves edited rows alone by design — `prepareLibrary` inserts
only ids that are absent — so editing a bundled row breaks nothing. It means that row
never receives a future upstream correction, which the main spec already establishes is
true of every row.

Reset is cheap insurance because the 650 bundled entries ship inside the app bundle, so
restoring one is a lookup rather than a download.

## Data access

### `src/db/sessions.ts`

- **`getInProgressSession()`** — read-only, therefore safe inside a `useLiveQuery`.

  `status` is indexed and is a *string*, so `.where('status').equals('in_progress')` is
  legal. Stated explicitly because the never-`.where()` rule covers booleans and nulls,
  and over-applying it here would mean hand-filtering every session for no reason.
  `Session.routineId` is the nullable field and stays unindexed.

- **`startSession(routine)`** — opens a readwrite transaction, re-checks that nothing is
  in progress, then creates the session with `name` snapshotted from the routine. Same
  shape and same reason as `getOrCreateActiveCycle`: StrictMode double-invokes effects.

  **Called only from a click handler, never from a querier.** This is how the
  `ReadOnlyError` trap is avoided. `/session` creates nothing; landing there with no
  session in progress redirects to Today.

- **`finishSession(id)`** — sets `endedAt` and `status: 'completed'` *and* advances the
  cycle, in one transaction across both tables. Separating them would leave a completed
  session with a stale rotation pointer. No special case is needed for a routine
  archived mid-session: `advanceAfter` already returns the cycle unchanged when
  `indexOf` is `-1`.

- **`discardSession(id)`** — deletes the session and its sets.

  A real hard delete, and a correct one. The never-hard-delete rule protects rows that
  other rows reference; nothing references a `Session` except the `LoggedSet`s that go
  with it. An `abandoned` status was rejected: it buys nothing and makes History filter
  forever.

### `src/db/sets.ts`

`listSetsForSession`, `logSet`, `updateSet`, `deleteSet`, plus the hot query.

- **`lastPerformance(exerciseId, excludeSessionId)`** — walks `[exerciseId+completedAt]`
  backwards for the newest set outside the current session, takes that set's
  `sessionId`, then fetches every set from that session for that exercise. Two indexed
  reads.

  The one-pass version — walk backwards collecting until `sessionId` changes — assumes
  sets from one session are contiguous in `completedAt` order. Editing a past session in
  Plan 5 breaks that assumption, and the symptom would be a silently truncated last-time
  line that nobody connects back to the edit.

`updateSet` strips `id` from its changes, mirroring `updateExercise`: Dexie turns an
`id` inside an update payload into delete-then-add under the new key.

### `src/db/routines.ts`

Gains **`updateRoutineItems(id, mutator)`**, which performs the read-modify-write inside
a transaction. See Concurrency below.

## Pure domain

Both modules are I/O-free with type-only imports from `src/db/types`.

### `src/domain/measurement.ts`

`measurementFields(type)` returns which inputs a measurement type needs, table-driven
across all six:

| Type | Inputs |
| --- | --- |
| `weight_reps` | weight, reps |
| `bodyweight_reps` | reps |
| `assisted_reps` | assistance weight, reps |
| `duration` | seconds |
| `distance_duration` | metres, seconds |
| `weight_duration` | weight, seconds |

For `assisted_reps`, `LoggedSet.weight` holds the **assistance** applied, not the load
lifted — the machine's counterweight. It is stored as a positive number with the unit it
was entered in, like every other weight, and labelled "assistance" in the UI so it is
never read as load.

`formatSet` renders the reference line: `135 lb × 8`, `0:45`, `400 m in 1:30`.

This is where the decision to carry `measurementType` from the start pays out. It is six
table rows and six tests, and without it planks, dips, assisted pull-ups and treadmill
work would each need their own schema.

### `src/domain/setPlan.ts`

`planSets({ targetSets, lastPerformance, logged })` derives the unconfirmed rows. Count
is `targetSets`, else last time's working-set count, else 1, minus the working sets
already logged, clamped at zero — logging more sets than prescribed leaves no planned
rows rather than a negative count. Row *N* prefills per the rule above. Warm-ups never
consume a planned row; they are additive.

## Screens

### Today

One added query and two states.

- A session in progress → **Resume — Push A, started Tuesday 6:12pm**.
- Otherwise → **Start {up-next routine}**, plus **Do a different one**, listing the
  non-archived routines.

Both start paths call `startSession(routine)` from a click handler, then navigate. The
session gets no nav tab: Resume on Today is the way back in, and a tab that is dead most
days is not worth the space.

### `/session`

Singular, with no id, because the resume rule guarantees at most one. History takes
`/history/:sessionId` in Plan 5.

Loads session, routine, sets and exercises through read-only queriers. Per the main
spec: a strip across the top to jump between exercises, one exercise in focus below it.

The focused exercise shows its name, its prescription (`4 × 6–8`, and `rest 2:00` where
set), the last-time line, then logged rows followed by planned rows, an **Add set**, and
a warm-up toggle per row.

**The session's exercise list is derived, not stored:** the routine's items, plus any
exercise that has logged sets and is not in the routine. That is what makes **Add
exercise** free — it reuses `ExerciseBrowser` and writes nothing.

The consequence, accepted: add an exercise, kill the tab before logging anything, and it
is gone on resume. Nothing was lost, because nothing was done.

**Finish** → `finishSession` → Today. **Discard** → confirm → `discardSession` → Today.

### RoutineEditor

Four inputs per item — sets, rep min, rep max, rest — written through
`updateRoutineItems`. The mutation itself is a pure function,
`setItemPrescription(items, itemId, patch)`, added to `domain/routineItems.ts` beside
`addItem`/`moveItem`/`removeItem`, so the editor stays a renderer.

Blank means unset (`undefined`, never `0`). `repMin ≤ repMax` is validated.

`restSeconds` ships here despite its timer arriving in Plan 4. It is not a writer with
no reader — the session screen displays it — and splitting it out means editing this
form twice.

### Library

The gate becomes `onSelect={(e) => setEditing(e)}`. `CustomExerciseForm` grows **Reset to
bundled**, rendered only when `existing && !existing.isCustom`, which re-reads the row
from the bundled JSON and writes it back through `updateExercise` — whose `id` and
`isCustom` stripping is exactly right for that call.

Two repairs ride along in files this plan already opens:

- `updateExercise`'s comment claims `isCustom` is stripped because flipping it "corrupts
  the seed gate, which counts non-custom rows to decide whether the bundled library
  still needs seeding". **That gate no longer exists** — `prepareLibrary` is id-based.
  The strip stays; the reason gets corrected.
- `CustomExerciseForm.handleArchive` is still fire-and-forget. It predates
  `useWriteError` and gets retrofitted.

### Archived exercises in routines

Flagged in the Plan 2 review: an archived exercise in a routine renders identically to
an active one, and a session started from that routine will log sets against it.

RoutineEditor and the session screen both mark it `(archived)`. **Marker only** — the
session screen still permits logging, since the user may have archived it by mistake and
is standing at the machine.

## Concurrency and error handling

Plan 2's deferred finding was that handlers recompute from an array captured at render,
so a second fast tap works from stale input. In a reorder list that costs a tap. In a
set list it costs a logged set.

Two fixes, one per shape:

- **Confirming a set computes its `order` inside the write transaction** from a fresh
  read, never from the array in the closure, and the row's control is disabled while its
  write is in flight. Two taps then produce either one set or two correctly ordered
  ones — never two sets both claiming `order: 3`.
- **`updateRoutineItems(id, mutator)`** does the read-modify-write in a transaction.
  RoutineEditor's four handlers — up, down, remove, and the new prescription edit — all
  route through it, retiring the deferred finding instead of adding a fifth handler with
  the same flaw.

Every database write from an event handler goes through `run(...)` from
`src/ui/useWriteError.ts`, the session screen included.

## Testing

- **Pure domain.** `measurementFields` and `formatSet` across all six types. `planSets`
  against: no target, target set, partially logged, warm-ups do not consume a row, and
  last time shorter than the target.
- **`fake-indexeddb`.** `startSession` refuses a second in-progress session.
  `finishSession` flips status and advances the rotation atomically. `finishSession` on
  an archived routine leaves the cycle untouched. `lastPerformance` excludes the current
  session, selects the right session, and survives non-contiguous `completedAt`.
  `discardSession` takes the sets with it. `logSet` assigns distinct orders under
  concurrent calls.
- **React Testing Library on Active Session**, the one screen the main spec names for
  component testing: prefill, confirm writes, add and remove sets mid-workout, warm-up
  flagging, redirect when nothing is in progress, and the test that encodes the whole
  autosave decision — **log two sets, unmount, remount, assert both survived and the
  planned rows resume at set 3.**
- **Regression.** The existing `schema.idxByName` assertion continues to pin
  `isCustom`, `isArchived`, `isActive` and `Session.routineId` as unindexed.

## Task shape

Eight tasks, matching Plan 2's size.

1. Session and set data access, including `lastPerformance`
2. `domain/measurement.ts` — the six-type table and formatting
3. `domain/setPlan.ts` — planned-row derivation
4. `updateRoutineItems`, `setItemPrescription`, and the prescription UI *(item 6)*
5. Bundled exercise editing, Reset to bundled, and the two riding repairs *(item 8)*
6. Today — Resume, Start, and pick a different routine
7. Active Session — strip, focus, set rows, confirm, add and remove, warm-up
8. Add exercise mid-session, Finish, Discard, cycle advancement

Tasks 2, 3 and 5 depend on nothing and can run in parallel.

**No CSS in this plan.** Visual design stays deferred until the screens settle.

## Out of scope

- Rest timer, Wake Lock, audible alerts — Plan 4
- History browsing and editing, PR detection, estimated 1RM — Plan 5
- Program template import — folds into the backup plan
- Freestyle sessions, RPE, supersets — schema hooks only, as originally designed
- Draft persistence for unconfirmed rows — a strict add-on if it ever proves necessary

## Inherited constraints

The constraint list in `HANDOFF-2026-08-17-plan-3-active-session.md` applies unchanged
and is not restated here. The three that bear directly on this plan:

- A `liveQuery` querier may not open a readwrite transaction. Handled by creating
  sessions from click handlers only.
- Weight is stored with the unit it was entered in and never converted.
- Bundled exercise ids are upstream slugs. `LoggedSet.exerciseId` references them.
