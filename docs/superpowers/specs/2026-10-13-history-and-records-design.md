# History and Records — Design Spec

**Plan 5.** History browsing and editing of past workouts, plus personal-record (PR)
detection with badges and a records list per exercise.

The parent design (`2026-08-04-workout-tracker-design.md`) already decided the shape of
both features. This spec settles what it left open. The user answered four scoping
questions on 2026-10-13 and then handed the rest over; every decision below that is not
one of those four answers is marked **(my call)**, so it can be checked and overturned.

## Why this exists

The app can plan a workout, log it, and time the rest between sets. What it cannot do is
look back. A finished workout disappears into IndexedDB with no way to see it, correct a
typo in it, or notice that it contained a best-ever set. The stated goal of the whole app
is tracking progressive overload, and today the only trace of progress is the "last time"
line on the next workout.

## What the user decided

1. **Editing past workouts covers all four kinds of edit:** fix a logged set's numbers
   and warm-up flag; delete a single set or a whole workout; add a forgotten set to a
   past workout, for an exercise already in it; change a workout's date and time.
2. **PR badges appear in all three places:** live on the set row the moment a PR is
   logged mid-workout; on past workouts in History; and on a records list per exercise.
3. **PRs cover `weight_reps` exercises only** — exactly the three types the parent design
   specified. Bodyweight, assisted, timed and distance exercises get no PRs in this plan.
4. **The post-deploy reload that can wipe typed-but-unlogged set values is out of
   scope.** It stays a separate follow-up, recorded in the rest-timer spec's open-defect
   section.

## Goals, non-goals, anti-goals

**Goals.** See every finished workout, newest first. Open one and see exactly what was
done. Correct any of it. Know when a set was a personal best — at the moment it happens,
and afterwards.

**Non-goals.** Charts, estimated-1RM trends, weekly volume by muscle, goals, bodyweight —
all v2, per the parent design. PRs for non-`weight_reps` exercises. Editing the
in-progress workout from History. Adding a new exercise to a past workout. CSS.

**Anti-goals** — things that would make this a failure even if it technically worked:

- **A fake PR.** One that appears because of unit-conversion drift, a tie, or the first
  set ever logged. The parent design stores weight in the unit it was entered in
  precisely to prevent this, and the PR rules below exist to keep that promise.
- **An edit that corrupts history silently.** Moving a workout's date without moving its
  sets would leave the "last time" prefill pointing at the wrong workout, with nothing
  visibly wrong.
- **A failed write that discards what the user typed.** That bug shipped twice in Plan 3.
  History's edit forms are new surfaces for it.

## Personal records

### The three types, unchanged from the parent design

Per exercise, over **working** sets only (warm-ups never count):

1. **Heaviest** — the most weight lifted for at least one rep.
2. **Rep best** — the most reps at a given weight.
3. **Best estimated 1RM** — Epley, `weight × (1 + reps / 30)`, for sets of 12 reps or
   fewer.

### What makes a set a PR — (my call) throughout

PRs are **computed on demand, never stored**, as the parent design requires: a stored PR
table would need invalidating on every edit of a past workout, which is now a routine
operation.

A set qualifies for PR consideration only if its exercise's **current** `measurementType`
is `weight_reps`, it is `working`, `weight` is set, and `reps` is at least 1. All of an
exercise's qualifying sets — across every workout, the in-progress one included — are
put in chronological order: `completedAt`, then `order`, then `id`, so the order is
total and deterministic. A set is a PR of a given type when it **strictly beats every
earlier qualifying set** on that type:

- **Heaviest:** its weight is greater than every earlier set's weight.
- **Est. 1RM:** its estimate is greater than every earlier estimate. Sets above 12 reps
  have no estimate and neither set nor block this record.
- **Rep best:** at least one earlier set was at *exactly the same weight and unit*, and
  this set has more reps than all of them.

Three consequences are deliberate:

- **The first set ever logged for an exercise is never a PR.** There is nothing to beat,
  and badging it would badge every exercise on its first day. The same holds for each
  type independently: the first set that has an estimated 1RM sets the bar, it doesn't
  beat it.
- **A first time at a new weight is never a rep best.** A new weight above everything
  before it is a *heaviest* PR instead. A new weight below the best is simply not a
  record — nothing was beaten.
- **Ties are not PRs.** Doing 225 × 5 again is matching a best, not beating it.

A set can be more than one PR at once — a new heaviest single is usually a new estimated
1RM too — and its badge names every type it earned.

**Single-rep estimate (my call):** a 1-rep set's estimated 1RM is its weight. Raw Epley
gives `weight × 1.033` at one rep, which would rank a true single below a heavier
estimate from a triple that was never lifted.

### Units — (my call)

Weight is stored in the unit it was entered in and is **never** converted on write. PR
detection compares weights across units by converting to kilograms *for comparison
only*, using the exact definition `1 lb = 0.45359237 kg`. A comparison counts as
"greater" only if it exceeds by more than `1e-9 kg`, so floating-point noise cannot
mint a record. **Rep bests do not cross units:** 100 kg and 220.5 lb are different
weights for this purpose, because declaring them equal is exactly the drift the
storage rule exists to avoid.

Displayed numbers always appear in the unit of the set they came from. The estimated
1RM is shown in its source set's unit, rounded to one decimal place.

### Where the rules live

All of the above is **pure** and goes in a new `src/domain/records.ts`: the conversion,
the estimate, PR detection over an exercise's sets, and the current-records summary.
Every rule is table-testable with no database and no clock, the same way the rest
timer's rules were.

## History

### The list — `/history`

**Completed** workouts only, newest first by start time **(my call)**. The in-progress
workout already has its own entry point in Today's Resume, and putting it here as well
would create a second way into an edit surface that History does not own. Each row shows
the workout's name, date and start time, duration, how many working sets it held, and how
many of those were PRs — counting sets that earned at least one PR type, not badges
**(my call)**. The whole list renders — no pagination **(my call)**: one person
training four days a week makes about 200 workouts a year. Tapping a row opens the
workout.

A **History** tab joins the bottom nav, between Today and Routines **(my call)**.

### One workout — `/history/:sessionId`

The workout's name, date, start time and duration, then each exercise in the order it was
first trained that day **(my call: by the earliest set's time, not the routine's item
order, because History shows what was done rather than what was planned)**. Under each,
its sets in order: numbered from 1, warm-ups marked, PR sets badged with the types they
earned. Each `weight_reps` exercise's heading links to its records page.

An unknown session id shows a not-found message with a way back to the list. An
**in-progress** session id redirects to `/session` **(my call)** — History never edits
the live workout.

### Editing

All four kinds of edit from the user's answer:

- **Fix a set.** Edit opens the set's fields — the same ones the measurement type shows
  in the active session — plus the warm-up flag, with Save and Cancel. Weight keeps the
  unit it was logged in.
- **Delete a set.** One tap, no confirmation **(my call)** — matching Remove on a logged
  set in the active session. Deleting an exercise's last set removes the exercise from
  the workout, because a past workout's exercise list is derived from its sets.
- **Add a forgotten set.** An Add set control under each exercise opens empty fields
  prefilled from that exercise's last set in this workout, unit included. The new set
  takes the next `order` for that exercise, computed in the write transaction exactly as
  `logSet` does, and a `completedAt` **1 millisecond after that exercise's latest set in
  this workout (my call)**. It must sort inside the workout it belongs to, or it would
  corrupt both "last time" and PR order.
- **Delete the workout.** Behind a confirmation, like Discard. Removes the session and
  all of its sets in one transaction, then returns to the list. **It does not touch the
  rotation (my call)**: rewinding which routine is next because an old workout was
  deleted would surprise far more often than it would help.
- **Change the date and time.** A date-and-time input for when the workout started.
  Saving shifts `startedAt`, `endedAt` **and every one of its sets' `completedAt`** by
  the same amount, in one transaction. This is the corrupting-edit anti-goal: the "last
  time" prefill and PR order both read `completedAt`, so a date change that moved only
  the session would leave both pointing at the wrong workout. **A workout cannot be
  moved so that it ends in the future (my call).** The write takes the *new absolute
  start time*, and computes the shift inside the transaction from a fresh read of
  `startedAt` **(my call)**. A shift computed at render time would be applied twice by a
  double-tap on Save. And because the date-and-time input carries no seconds, a value
  equal to the current start time to the minute is a no-op, rather than a shift by the
  dropped seconds.

Every edit writes through `run(...)`, with the local `wrote` flag deciding whether the
form closes. **A failed write leaves the form open with everything the user typed in
it.** That is the Plan 3 rule, applied to every new form here.

Field parsing **mirrors `confirmSet` exactly (my call)**: blank and non-numeric fields
are dropped, and a form where nothing parses writes nothing. No validation is added that
the active workout doesn't have, so the two edit surfaces cannot disagree about what a
valid set is.

Because PRs are derived, an edit to one workout can add or remove badges on later ones.
That is correct, and it is free: every screen recomputes from current data.

### `finishSession` gains its already-completed guard

The Plan 4 handoff required this before History could exist. Finishing a session that is
already `completed` becomes a **no-op (my call)** — it neither re-stamps `endedAt` nor
touches the rotation. That makes the call idempotent, as `startSession` already is, so a
double-tap on Finish cannot corrupt a past workout's duration.

## The records list — `/exercises/:exerciseId/records`

One page per exercise **(my call: a page of its own, rather than a section of the
Library's edit form, because that form is for changing the exercise's definition)**:

- **Heaviest:** the weight and reps of that set, and its date.
- **Best estimated 1RM:** the estimate, the set it came from, and its date.
- **Rep bests:** the most reps at each weight ever lifted, heaviest weight first, each
  with its date. Different units are separate rows.

A non-`weight_reps` exercise shows a one-line note that records are kept for weight-and-
reps exercises only. An exercise with no qualifying sets says no working sets have been
logged yet. An unknown exercise id shows not-found, as History does. Archived exercises
keep their records. When two sets tie for a record, the page shows the earlier one — the
one that set it, consistent with "strictly beats".

It is reachable from each exercise heading in a past workout, and from the Library
**(my call)**. The Library has no read-only view of an exercise — tapping one opens its
edit form — so the link is rendered beside that form, for existing exercises only. Beside
rather than inside, so the form stays free of router dependencies, along with its tests.

## Live badges in the active workout

When a set logged in the active workout is a PR, its row in the logged-sets list shows
the badge — immediately, because the screen's single querier re-runs on every write.
The querier gains one read per `weight_reps` exercise in the workout: that exercise's
qualifying sets across all workouts, run through the same pure detection. Warm-ups, other
measurement types, and exercises with no history show nothing.

This is the one change to `ActiveSessionScreen`, and it stays inside the existing
querier, keeping the one-querier-per-screen rule.

**Badges change as you edit (my call).** Log 225 × 5 for a PR, then log 230 × 5 — the
first stays a PR, because it beat everything *before* it. Delete a set and later badges
re-evaluate. Every badge always answers "did this beat everything before it, given the
data as it stands now".

## Data access

New or changed functions, all following the existing patterns:

- **`listCompletedSessions()`** — read-only; `status` is an indexed string, so
  `.where('status')` is correct here.
- **`listSetsForExercise(exerciseId)`** — every set for an exercise in chronological
  order, read through the existing `[exerciseId+completedAt]` index. Read-only, so safe
  inside a querier.
- **Add a set to a past workout** with an explicit `completedAt`, computing `order`
  inside the write transaction, like `logSet`.
- **Shift a workout's time** — session and every set together, one transaction.
- **Delete a completed workout** — session and sets in one transaction; refuses a
  session that is still in progress, which has Discard.
- **`finishSession`** — the already-completed no-op above.

No schema change, no new index, no migration. Every table and index this needs already
exists.

## Inherited constraints that bite here

The full list is in `HANDOFF-2026-09-04-plan-4-rest-timer.md`. The ones this plan is most
likely to trip:

- **One querier per screen.** Each new screen reads everything it renders in one
  `useLiveQuery`.
- **A querier may not open a readwrite transaction.** Every write above happens in an
  event handler.
- **`run(...)` never rejects**; whether a write landed is known only from a local flag.
- **A failed write must never discard what the user typed.**
- **Never pass `id` inside a Dexie `update()` payload.** `updateSet` already strips it.
- **Weight is never converted on write.** Conversion exists for comparison only.
- **`src/domain/` is pure.** `records.ts` imports types, nothing else.
- **Focus is identity-based, not positional** — list items keyed by id, never by index.
- **Every test must be shown failing before it counts**, and **`npx tsc --noEmit` must
  exit 0**: both earned their place in Plan 4.

## Known interaction with the rest timer

Adding a History tab makes an existing, documented limitation easier to reach: the rest
timer lives inside the active-workout screen, so switching tabs mid-rest stops it, as the
rest-timer spec's known-limitation section records. Nothing here changes that. It is
noted so it isn't mistaken for a regression.

## Left to the builder

How the edit forms are laid out; the exact badge wording, as long as it names each PR
type; and how the screens divide into components — the active-workout screen is already
over 400 lines, and nothing here should make it bigger than the badge prop requires.
