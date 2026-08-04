# Workout Tracker — Design Spec

**Date:** 2026-08-04
**Status:** Approved for planning

## Purpose

A personal iPhone app for planning weekly gym workouts, logging sets as they happen,
and making progressive overload visible. Single user, no sharing, no accounts.

Success means: at the gym, mid-workout, logging a set takes one tap and the numbers
I need to beat are already on screen.

## Platform decision

Built as an **installable PWA** (home-screen web app), not a native iOS app.

The deciding constraint is that development happens on Windows 11. Xcode is
macOS-only and is required to build and sign iOS and watchOS apps. Native SwiftUI —
and therefore an Apple Watch companion app — is unavailable without a Mac.

Accepted consequences:

- No Apple Watch app.
- No HealthKit integration.
- No App Store distribution; installed via Safari "Add to Home Screen".
- iOS reclaims web storage more aggressively than native app storage, which
  promotes backup/export from a nice-to-have to a v1 requirement.
- No haptic alerts. The Vibration API is unsupported in iOS Safari, which constrains
  how the rest timer can signal; see Rest-over alerting.

## Architecture

**Stack:** React + TypeScript + Vite · Dexie over IndexedDB · `vite-plugin-pwa`.

Alternatives considered: SvelteKit (smaller bundle, better ergonomics, thinner
charting/testing ecosystem) and vanilla TS + Web Components (no framework churn, but
state management becomes a homegrown framework at this size). React wins on ecosystem
for the two things this app needs: a fast list/form UI and decent charts.

**No backend.** No server, no accounts, no sync, no recurring cost. All data is local.

### Modules

| Module  | Responsibility                                                                                          | Depends on      |
| ------- | ------------------------------------------------------------------------------------------------------- | --------------- |
| `db/`   | Dexie schema, migrations, queries. The only code that touches IndexedDB.                                   | —               |
| `domain/` | Pure functions: PR detection, estimated 1RM, volume math, cycle advancement, plate math, unit conversion. No I/O. | —               |
| `ui/`   | Screens and components.                                                                                   | `db`, `domain`  |
| `pwa/`  | Service worker, install prompt, persistent-storage request, backup export/import.                          | `db`            |

`domain/` is kept pure and I/O-free so the logic most likely to harbour bugs is
testable with plain function calls and no database fixtures.

## Data model

### Exercise

A movement definition. Bundled and custom exercises share this shape exactly.

```
id · name · primaryMuscles[] · secondaryMuscles[] · equipment
measurementType · instructions? · isCustom · isArchived · defaultIncrement?
```

`measurementType` is one of: `weight_reps`, `bodyweight_reps`, `assisted_reps`,
`duration`, `distance_duration`, `weight_duration`. This is what lets planks, dips,
assisted pull-ups and treadmill work share one schema. Adding it later would be a
painful migration, so it exists from the start.

Muscles are split primary/secondary so per-muscle weekly volume is meaningful.

`equipment` is one of: `barbell`, `dumbbell`, `machine`, `cable`, `bodyweight`,
`kettlebell`, `band`, `smith`, `ez_bar`, `other`.

### Routine

A named, ordered workout template. This single entity covers both "group exercises
into a titled workout" and "templates" — they are not separate concepts.

```
id · name · notes? · items[] · isArchived · createdAt · updatedAt
```

**RoutineItem** is embedded in the routine document (never queried independently):

```
exerciseId · order · supersetGroup? · restSeconds?
targetSets? · targetRepMin? · targetRepMax?
```

The three `target*` fields are unused in v1. They are the forward-compatibility hook
for suggested progression (v3), so adding that feature later requires no migration.

### Cycle

The rotation. Replaces calendar-based scheduling.

```
id · name · routineIds[] (ordered) · currentIndex · isActive
```

**Advancement rule:** completing a session from routine `R` sets
`currentIndex = position(R) + 1`. Doing a routine out of order re-anchors the cycle
there rather than leaving the app permanently out of sync. Multiple cycles may exist;
exactly one is active.

Rationale for rotation over calendar: a weekday-bound schedule creates a permanent
visible gap when a day is missed, and cannot answer "what should I do today?" on an
unplanned gym visit.

### Session

A performed instance of a workout.

```
id · routineId? (null = freestyle) · name · startedAt · endedAt?
status: in_progress | completed · notes? · bodyweightAtTime?
```

`name` is snapshotted from the routine at creation time, so renaming a routine later
does not rewrite history.

### LoggedSet

```
id · sessionId · exerciseId · order · setType: working | warmup
weight? · unit · reps? · durationSeconds? · distanceMeters?
rpe? · completedAt · notes?
```

`distanceMeters` is canonical in metres and converted for display, unlike weight —
distance has no plate-math or exact-recall requirement, so drift is harmless here.

`rpe` has no v1 UI. Like the `target*` fields on RoutineItem, it exists so
autoregulation can be added later without a migration.

**Weight is stored as a number plus the unit it was entered in, never converted to a
canonical unit.** A set logged as 135 lb remains exactly `135 lb` forever.
Round-tripping through kg introduces floating-point drift that eventually renders as a
fake PR. Charts convert for display only.

### Supporting entities

- **BodyweightEntry** — `id · date · weight · unit`
- **Goal** — `id · type · exerciseId? · targetValue · targetReps? · unit? · targetDate? · createdAt · achievedAt?`
  where `type` is `lift_1rm | lift_weight_reps | bodyweight | frequency`
- **Settings** (singleton) — `unitPreference · defaultRestSeconds · lastBackupAt`

`BodyweightEntry` and `Goal` tables are created by the v1 schema, but their UI ships in
v2. Defining them now keeps the backup format stable across the v1 → v2 boundary.

### Derived, not stored

**Personal records are computed on demand** by scanning set history, not persisted.
A stored PR table would require invalidation on every edit of a past workout, which is
a routine operation. Scanning a few thousand sets is instant.

Three PR types are recognised, per exercise, over working sets only:

1. **Heaviest weight** lifted for at least one rep.
2. **Most reps** at a given weight.
3. **Best estimated 1RM**, using the Epley formula (`weight × (1 + reps/30)`), capped
   at 12 reps because the estimate degrades badly beyond that.

### Indexes

The hottest query is "what did I do last time on this exercise?" — it renders for
every set of every workout. Served by a compound index on `[exerciseId+completedAt]`.
Also indexed: sets by `sessionId`, sessions by `startedAt`.

## Screens

| Screen             | Purpose                                                                 |
| ------------------ | ----------------------------------------------------------------------- |
| **Today**          | Next routine in the cycle, Start button, "pick something else", last-trained line |
| **Active Session** | Set logging. See detailed spec below.                                    |
| **Routines**       | List, create, edit, reorder exercises                                    |
| **Cycle**          | Order routines into the rotation                                         |
| **Library**        | Search and filter by muscle and equipment; exercise detail; create custom |
| **History**        | Sessions by date; view and edit past sessions                            |
| **Progress**       | PRs, per-exercise charts, weekly volume                                  |
| **Settings**       | Units, default rest, backup export/import                                |

### Active Session — detailed spec

The design constraint is the real environment: standing, one-handed, sweaty, possibly
with no signal.

- **One exercise in focus** at a time, with a compact strip to jump between them.
- **Last session's numbers are always visible** above the set rows, and every input is
  **prefilled** with them. The common case — same weight, same reps — is one tap per
  set and zero typing.
- **Completing a set auto-starts the rest timer**, using that routine item's
  `restSeconds` or the global default.
- **Sets can be added or removed mid-workout.**
- **Warm-up sets are flagged** and excluded from PR and volume calculations.
- **Continuous autosave to IndexedDB.** Safari killing the tab mid-workout must lose
  nothing; reopening resumes exactly where the session left off.

Two implementation requirements that are expensive to retrofit:

1. **The rest timer must be timestamp-based, not `setInterval`-based.** Safari suspends
   background tabs and intervals stop firing. Store a target end-time and recompute on
   resume.
2. **Rest-over alerting is constrained by the platform.** The Vibration API is
   unsupported in iOS Safari, so a haptic buzz is unavailable at any price. Three
   mechanisms were evaluated; see below.

#### Rest-over alerting

**Primary mechanism (v1): Screen Wake Lock.** `navigator.wakeLock` is supported in
iOS Safari 16.4+. The timer acquires a lock when rest begins and releases it when the
next set is logged, keeping the screen awake with a large visible countdown. No
server, no network, no permission prompt.

Its limit is precise and must be designed around: **the lock is released automatically
whenever the document becomes hidden** — switching apps or manually locking the phone
both drop it — and it is not restored automatically. The app must re-acquire on
`visibilitychange` when it becomes visible again. Coverage is therefore:

| Situation                        | Wake Lock  | Covered by      |
| -------------------------------- | ---------- | --------------- |
| Phone visible, app open          | holds      | Wake Lock       |
| User switches to another app     | released   | audio cue only  |
| User locks the phone             | released   | audio cue only  |

**Secondary mechanism (spike first): background audio cue.** iOS permits web audio to
continue while backgrounded provided playback is already running. The approach is to
start a silent looping track when rest begins and play the alert tone at the end,
which reaches the user through earbuds — often preferable to a haptic in a gym.

This is the only mechanism covering the app-switch case, which is common (users switch
to a music app mid-rest), so it carries real weight. It is nonetheless **unproven on
device** and gated behind a spike (see Open questions) for two reasons: it may
interrupt or duck the user's own music, which would be worse than the problem it
solves; and background-audio survival has been fragile across iOS releases. Recent
Safari exposes `navigator.audioSession`, which should permit requesting an
ambient/mixing category rather than seizing the audio session — this needs verifying,
not assuming.

**Rejected: Web Push.** iOS 16.4+ does support Web Push for home-screen-installed
PWAs, including while locked. It is rejected because pushes must originate from a
server — Safari exposes no local scheduled-notification API, and the Notification
Triggers API never shipped outside a Chrome origin trial. Adopting it would reinstate
the backend this design deliberately removes *and* would require live network in a gym
basement, the exact environment where it must work.

## Scope

### v1 — the spine

- Bundled exercise library of roughly 150–250 exercises, sourced from
  `free-exercise-db` (public domain) and re-tagged to this schema's muscle, equipment
  and `measurementType` vocabularies. The source set is larger; it is trimmed to
  common gym movements to keep search usable and the bundle small. Images are not
  bundled.
- Search and filter by muscle and equipment
- Custom exercises, identical in shape to bundled ones
- Routine create / edit / reorder
- Cycle rotation and Today screen
- Active session logging across all six measurement types, with last-time reference
- Rest timer, timestamp-based, with Screen Wake Lock and re-acquisition on
  `visibilitychange`
- History browse **and editing of past sessions**
- PR detection and badges
- Backup export / import, prompting when `lastBackupAt` is more than 14 days old
- PWA install, full offline operation, persistent-storage request
- Units setting (lb / kg)

PR detection is in v1 rather than v2 because it is a pure function over data already
collected plus a badge, and it is the cheapest feature that serves the stated goal of
promoting progressive overload.

### v2

Per-exercise charts (estimated 1RM, volume over time) · plate calculator · weekly
volume by muscle group · goals · bodyweight tracking

### v3 and later

Supersets · exercise substitution · suggested progression targets · deload support ·
automated cloud backup

Supersets and progression targets already have schema hooks in v1 and need no migration.

### Explicitly out of scope, permanently

Social feeds and sharing · AI-generated workouts · per-exercise video · nutrition and
macro tracking · user accounts.

### Dropped from the original feature list

- **Apple Watch app** — impossible without a Mac. See Platform decision.
- **Exercise difficulty rating** — the muscle and equipment filters carry the useful
  weight; difficulty is not used for filtering in practice.

## Error handling

All the failure modes that matter here are data-loss adjacent.

- **Never hard-delete an exercise or routine that has history.** Archive it. Hard
  deletion orphans every `LoggedSet` referencing it.
- **Backup import is all-or-nothing**, inside a single transaction, gated on a
  schema-version check. A partially applied import is worse than a failed one.
- **Backup files carry a schema version**, so files exported today restore correctly
  after future migrations.
- **IndexedDB unavailable** (private browsing, restrictive settings) fails loudly at
  startup. The app must never appear to work while writing to nothing.
- **Quota exceeded** surfaces to the user with an export prompt rather than failing
  silently.
- **All timestamps stored in UTC.**
- **Interrupted sessions** resume from IndexedDB on next open.

## Testing

Weighted toward where bugs would actually cause harm.

- **Vitest over `domain/`** — the bulk of the value, and cheap because these functions
  are pure: PR detection, estimated 1RM, cycle advancement, volume aggregation, plate
  math, unit conversion.
- **`fake-indexeddb` for `db/`** — migrations, the hot "last time on this exercise"
  query, archive-instead-of-delete behaviour.
- **React Testing Library on Active Session only** — the one screen with genuine
  interaction complexity: prefill, autosave, adding sets mid-workout, timer resume.
- **One Playwright end-to-end round-trip:** create routine → log session → finish →
  export → import into an empty database → verify identical data. This is the
  highest-value test in the suite; a corrupt backup is the only unrecoverable failure
  in the app.

Not doing: exhaustive component snapshot tests.

Implementation follows TDD.

## Open questions

### Spike 1 — background audio cue (do this first)

**Question:** can a PWA reliably play an alert tone after the user switches to another
app, without disrupting their music?

**Why it is first:** it is the only mechanism covering the app-switch and
screen-locked cases, and its answer cannot be obtained from documentation — it depends
on the behaviour of a specific iOS version on a real device. Learning the answer costs
roughly an hour now and considerably more once the session UI exists and would have to
be reworked around it.

**Method:** a throwaway static page, installed to the iPhone home screen, that starts
a silent looping track, waits 60 seconds, and plays a tone. Test four cases: app
foregrounded; app switched away; phone locked; and all of the above with Spotify
playing. Also test whether `navigator.audioSession` type `ambient` permits mixing
rather than interrupting.

**Outcomes:**

- *Works and mixes cleanly* → adopt as a v1 companion to Wake Lock.
- *Works but interrupts music* → offer as an off-by-default setting; interrupting the
  user's music without consent is worse than the missed alert.
- *Does not survive backgrounding* → Wake Lock alone, and the app-switch case is
  documented as unsupported.

No production code depends on the outcome; only the alerting layer changes.

### Deferred

Whether estimated 1RM should offer formulas other than Epley (Brzycki, Lombardi) is
deferred to v2, when charts make the difference visible.
