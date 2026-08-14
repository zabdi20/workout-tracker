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
- No App Store distribution; installed via Safari "Add to Home Screen" from
  <https://zabdi20.github.io/workout-tracker/>.
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

**Hosting: GitHub Pages**, project repo `zabdi20/workout-tracker`, served from the
subpath `/workout-tracker/`. This is static file hosting, not a backend — it serves the
app and never sees training data.

A stable HTTPS origin is required infrastructure, not deployment polish. A PWA is bound
to the origin it was installed from: its database, its service worker scope and its
update channel are all keyed to it. Installing from a temporary LAN address would
produce an app that cannot update and whose history is lost on reinstall — the exact
failure this design otherwise works hard to prevent.

The consequence is that the repository is public, since GitHub Pages on a private
repository requires a paid plan. Only source code is published. Training data lives in
on-device IndexedDB and is never transmitted anywhere.

Because Pages serves a project repo from a subpath, Vite's `base`, the manifest's
`start_url` and `scope`, and the service worker scope must all agree on
`/workout-tracker/`. A mismatch produces the worst failure mode available: the app
installs successfully and then fails to load offline.

Pages also has no SPA rewrite, so any client-side route needs a **deep-link fallback**:
the build copies `dist/index.html` to `dist/404.html`. Without it, a cold load of
`/workout-tracker/routines` — a bookmark, a shared link, a reload before the service
worker activates — gets GitHub's 404 page. `workbox`'s `navigateFallback` only helps
once the service worker already controls the page, so it cannot cover the first visit.
A static `public/404.html` does not work either: Vite copies `public/` verbatim, so it
would reference no hashed asset names.

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

**Bundled exercise ids are the upstream `free-exercise-db` slugs, not generated
UUIDs**, and must never be regenerated. `LoggedSet.exerciseId` references them, so
rebuilding the library with fresh ids would orphan every logged set on a device that
has already seeded. User-created exercises use `crypto.randomUUID()`.

`Settings.libraryVersion` records which bundled-library revision was seeded, so a
future correction can be reconciled onto an installed device without a schema
migration. The reconciliation logic itself is deliberately deferred until there is a
correction to ship.

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

**The pointer is identity-based, not positional.** Editing the rotation must never
silently change what you are about to train. Removing a slot before the pointer shifts
the pointer down with it; reordering carries the pointer along with the slot it was on.
Removing the pointed-at slot leaves the pointer in place, which then lands on whatever
followed.

This is why removal from the editor is by **index** rather than by routine id — a
routine may occupy several slots, and the user removed one specific slot. Archiving a
routine is the separate, id-based case: `withoutRoutine` strips every occurrence.

The first cut of this got it wrong. The editor spread `currentIndex` through untouched,
so removing an unrelated earlier entry moved the pointer to a different routine, and
could persist an out-of-range index for a later `advanceAfter` to read.

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
- **Settings** (singleton) — `unitPreference · defaultRestSeconds · lastBackupAt · restAlertSound`

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

| Situation                    | Wake Lock | Alerting                        |
| ---------------------------- | --------- | ------------------------------- |
| Phone visible, app open      | holds     | Wake Lock + foreground tone     |
| User switches to another app | released  | **none — unsupported on iOS**   |
| User locks the phone         | released  | **none — unsupported on iOS**   |

**Second mechanism (v1): foreground tone.** When the document is visible, play a
tone on timer completion. Silenceable via the `restAlertSound` setting.

**Background alerting is not possible and will not be attempted.** This was measured,
not assumed — see `docs/superpowers/spikes/2026-08-04-rest-alert-reach.md`.

iOS suspends both timers and audio playback when a PWA is backgrounded, regardless of
audio session category and regardless of whether the app is installed. On iOS 18.7 /
Safari 26.5.2, an installed app playing a pre-rendered track advanced its audio clock
5.5 s over 58 s away — under 7 % of real time — so a beep 30 s in could not sound.

Three approaches were tried and all fail:

- A silent looping keepalive plus a JS-timed tone. Timers freeze; a 30 s timer was
  measured firing at 81 s, on resume.
- A single pre-rendered track with the beep baked in, needing no JavaScript at fire
  time. The audio clock itself is suspended, so removing JS from the critical path
  changes nothing. This rules out the whole class of workaround.
- The `playback` audio session category, which is specified for background-capable
  media. It does seize the audio session — it demonstrably stopped a playing video —
  and still does not play while backgrounded. It costs the user their music and buys
  nothing, so it is not shipped.

This is a platform limit of the same kind as the absent Vibration API, not a design
choice.

**Consequence:** returning to the app after rest has elapsed is a normal flow, not an
edge case. The UI must make elapsed rest obvious on resume, and the timer must
recompute from its stored deadline rather than trusting accumulated ticks.

**Rejected: Web Push.** iOS 16.4+ does support Web Push for home-screen-installed
PWAs, including while locked. It is rejected because pushes must originate from a
server — Safari exposes no local scheduled-notification API, and the Notification
Triggers API never shipped outside a Chrome origin trial. Adopting it would reinstate
the backend this design deliberately removes *and* would require live network in a gym
basement, the exact environment where it must work.

## Scope

### v1 — the spine

- Bundled exercise library of roughly 590 exercises, sourced from `free-exercise-db`
  (public domain) and re-tagged to this schema's muscle, equipment and
  `measurementType` vocabularies. The source set holds 873; filtering to strength,
  powerlifting and olympic categories with mappable equipment yields 587. Images are
  not bundled; instructions are.

  An earlier draft of this spec called for 150–250 on the assumption that a larger
  list would be unwieldy and heavy. Measurement contradicted both halves: the
  bundle is 102 KB gzipped with instructions included, which is negligible for a
  one-time offline cache, and search plus muscle/equipment filters keep the list
  navigable at that size. Hand-curating ~590 entries would be a poor use of effort
  for a single-user app, so the natural filter output is kept as-is.
- Search and filter by muscle and equipment
- Custom exercises, identical in shape to bundled ones
- Routine create / edit / reorder
- Cycle rotation and Today screen
- Active session logging across all six measurement types, with last-time reference
- Rest timer, timestamp-based, with Screen Wake Lock and re-acquisition on
  `visibilitychange`
- Audible rest alert while the app is visible, silenceable via `restAlertSound`
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

## Resolved questions

### Spike 1 — how far does the rest alert reach? **RESOLVED**

Run 2026-08-04 on iOS 18.7 / Safari 26.5.2. Full method and measurements in
`docs/superpowers/spikes/2026-08-04-rest-alert-reach.md`.

**Result:** the pre-committed third outcome. Background alerting is impossible on iOS
for a PWA; foreground tone plus Wake Lock only. See Rest-over alerting above.

The spike paid for itself twice over. Without it, the rest timer would have been built
around a JS timer calling `play()` — an approach that measurably fires 51 seconds late
and only when the user happens to reopen the app. It passes every desktop test and
fails silently in a gym.

### Deferred

**Background alerting via the Shortcuts URL scheme.** Not yet tested. Since the PWA
itself cannot make noise in the background, the remaining idea is to hand the job to
something that is allowed to: `shortcuts://run-shortcut` is a public, documented URL
scheme that accepts input, so a hand-made Shortcut could start a native Clock timer.
The native timer then fires on a locked screen because it is iOS's own, not ours.

Unknowns: whether a custom URL scheme fires from a standalone PWA, whether Shortcuts
returns cleanly to the app, and how disruptive an app-switch per set feels in practice.

Costs regardless of outcome: one-time manual setup the app cannot perform on the user's
behalf, and a visible app bounce on every rest. If it works it ships as an **optional**
setting for pocketed-phone training; the foreground tone and Wake Lock remain the
default, since they require no setup.

Revisit after Plan 1. Does not block anything.

**Estimated 1RM formulas.** Whether to offer alternatives to Epley (Brzycki,
Lombardi) is deferred to v2, when charts make the difference visible.
