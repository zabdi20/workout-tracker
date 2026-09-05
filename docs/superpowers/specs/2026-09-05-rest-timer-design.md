# Rest Timer — Design Spec

**Plan 4.** Items 2 and 3 of the original v1 spine: a timestamp-based rest timer with
Screen Wake Lock, and an audible alert while the document is visible.

Supersedes nothing. The parent design's *Rest-over alerting* section
(`2026-08-04-workout-tracker-design.md`) remains the authority on what the platform
allows; this spec decides what to build inside those limits, and records one deliberate
deviation from it.

## Why this exists

Plan 3 shipped the timer's inputs and stopped there. `RoutineItem.restSeconds` is
editable in the routine editor and already rendered on the session screen as a static
`Rest 2:00` line. Nothing counts down. Completing a set is meant to start rest
automatically, and does not.

There is no schema work and no data work in this plan. Every value the timer consumes
already exists and is already read by the session screen's single querier.

## What the spike settled, and what follows from it

`docs/superpowers/spikes/2026-08-04-rest-alert-reach.md` established that background
alerting is impossible for a PWA on iOS: timers and the audio clock are both suspended
when backgrounded, regardless of audio session category or installation. Measured on
iOS 18.7 — an installed app advanced its audio clock 5.5 s over 58 s away.

That is not a caveat to work around. It is the design input:

- The countdown is **derived from a stored deadline**, recomputed on every render. No
  accumulated ticks. A 30 s `setInterval` was measured firing at 81 s.
- **Returning after rest has elapsed is the normal flow**, not the edge case. The UI
  must say how long ago it ended, not show `0:00`.
- **Wake Lock is dropped whenever the document hides** and is not restored
  automatically.

## Decisions

### The deadline lives in localStorage, not in Dexie

One record, because at most one session is ever in progress:

```ts
interface RestTimerRecord {
  sessionId: string;
  endsAt: number;        // epoch ms
  restSeconds: number;   // what was prescribed, for the banner's label
  firedAt: number | null;
}
```

Written on a confirmed set, read on mount, cleared on skip, finish and discard.

Dexie was rejected: a running rest interval is transient UI state, and putting it on the
`Session` row would push it into the backup format, into history rendering, and into
every future reader that has to learn to ignore it. React state alone was also rejected —
an installed iOS PWA frequently cold-reloads on resume rather than merely suspending, so
in-memory state loses the timer in exactly the long-rest case that most needs it.

`sessionId` is a guard, not a lookup key. A record whose `sessionId` does not match the
session in progress is stale — it belongs to a workout that was finished or discarded in
another tab or before a reload. It is cleared and treated as absent, never adopted.

Starting a timer while one is already running overwrites it: a new `endsAt` and
`firedAt` back to `null`. Logging a second set before rest ends restarts rest, which is
what the user just did physically.

A record can also go stale in time rather than identity. Someone who leaves a session
open overnight and resumes it the next morning would otherwise return to a banner
reading `Rest done — 743:12 over`, because `formatDuration` renders `m:ss` and has no
hours field. So the domain module carries the rule:

```ts
/** Past this the user is not resting, they left. */
export const STALE_OVERRUN_SECONDS = 30 * 60;

export function isStaleRestTimer(record: RestTimerRecord, now: number): boolean;
```

Applied when the record is loaded: a stale record is cleared and reported absent, exactly
like a mismatched `sessionId`. Thirty minutes is the longest gap that could still
plausibly be one rest.

### The countdown is a pure function of the deadline and the clock

`src/domain/restTimer.ts` is pure and I/O-free, like every other module under
`src/domain/`:

```ts
export type RestTimerView =
  | { phase: 'counting'; remainingSeconds: number }
  | { phase: 'elapsed'; overrunSeconds: number };

export function restTimerView(record: RestTimerRecord, now: number): RestTimerView;
```

`remainingSeconds` uses `Math.ceil`, so a 2:00 rest reads `2:00` at the instant it
starts rather than `1:59`. `overrunSeconds` uses `Math.floor` — elapsed time counts up
from zero. Both render through the existing `formatDuration`; do not write a second one.

Taking `now` as an argument rather than calling `Date.now()` internally is what makes
the arithmetic testable without fake timers, and it is the reason this module is the
first task in the plan.

### No late beep

The tone fires only when the deadline passes **while the document is visible**. If rest
elapsed while the phone was locked or Safari was backgrounded, returning to the app
shows the overrun in silence.

A beep on return would arrive minutes late for an event the user can already see on
screen, and it reads as "rest just ended" when it did not.

This is one pure function with three cases:

```ts
export type ToneAction = 'play' | 'suppress' | 'none';

export function toneAction(
  record: RestTimerRecord,
  now: number,
  trigger: 'tick' | 'became-visible',
  visible: boolean,
): ToneAction;
```

- already fired, or `now < endsAt` → `'none'`
- `trigger === 'became-visible'` → `'suppress'`
- `trigger === 'tick'` and visible → `'play'`
- `trigger === 'tick'` and hidden → `'none'`

`'suppress'` and `'play'` both mark the record fired; only `'play'` makes a sound.

`visible` is a parameter rather than a caller precondition on purpose. iOS suspends
intervals in a hidden document, but jsdom and desktop browsers do not — a tick while
hidden is reachable, and without this argument it would return `'play'` and beep into a
locked phone. Leaving the record unfired on a hidden tick is also what lets the
`'became-visible'` path suppress it correctly on return.

Muting is applied at the speaker, not in the state machine: `Settings.restAlertSound`
decides whether `'play'` reaches `playRestTone()`, and the record is marked fired either
way. A silenced timer and an audible one advance through identical states, so the
setting cannot introduce a timing bug.

### Wake Lock is held exactly while counting down and visible

```ts
export function shouldHoldWakeLock(
  record: RestTimerRecord | null,
  now: number,
  visible: boolean,
): boolean;   // record !== null && visible && now < record.endsAt
```

Acquire on the confirm tap, re-acquire on `visibilitychange` → visible while still
counting, release on elapse, skip, the next logged set, finish, discard and unmount.

**Deviation from the parent spec, accepted deliberately.** That spec says the lock
"releases it when the next set is logged." This releases at elapse instead. Two reasons:
a forgotten timer cannot then hold the screen awake indefinitely — and because the lock
is re-acquired on every return to visibility, a lifecycle tied to the next logged set
would keep re-acquiring for a session the user walked away from. Reducing the lock to a
single condition also removes the special cases where it would otherwise leak.

The cost is real and accepted: at `0:00` the screen may sleep on iOS's normal timeout
while the user sets up for the next set. The overrun is still there when they wake it.

Acquisition is best-effort. `navigator.wakeLock` is absent in jsdom and can reject when
the document is not visible, so every call is guarded and a failure is silent — the
screen simply sleeps normally. The timer itself never depends on the lock.

### Skip is the only control

The banner carries a countdown and one button. No ±30 s, no mute toggle, no manual
start.

Skip is not optional: without it, a banner the user does not want sits there holding the
screen awake until they log the next set. It clears the record, which releases the lock
by the condition above.

`restAlertSound` is **read but never written in this plan.** Its toggle belongs to the
Settings screen, which ships with backup export/import in Plan 6 alongside
`unitPreference` and `defaultRestSeconds`. Until then the tone is on. This is a knowing
gap in the parent spec's "silenceable via the `restAlertSound` setting" — the mechanism
is honoured, the control is not yet built.

### The banner is session-global and rendered by every return path

It sits immediately after the write-error alert and above the exercise nav. The timer
does not belong to an exercise: it keeps running when the user switches focus, and
nesting it in a per-exercise block would say otherwise.

It is declared as a `const` beside `sessionControls` and rendered by **all three** return
paths — the empty-routine branch, the unknown-exercise branch, and the main one. The file
already carries the comment explaining why: a control that exists in one branch and not
another rots, and the branch nobody notices is broken is the one that behaves
differently.

The existing `Rest 2:00` line stays. That is the focused exercise's prescription; the
banner is the live countdown. They are different facts.

## Modules

### `src/domain/restTimer.ts` — new, pure

`RestTimerRecord`, `RestTimerView`, `ToneAction`, `restTimerView`, `toneAction`,
`shouldHoldWakeLock`, `isStaleRestTimer`, `STALE_OVERRUN_SECONDS`. A type-only import
from `src/db/types` would be fine here; it needs none.

### `src/ui/session/restTimerStore.ts` — new

```ts
export function readRestTimer(sessionId: string): RestTimerRecord | null;
export function writeRestTimer(record: RestTimerRecord): void;
export function clearRestTimer(): void;
```

Every access is wrapped: Safari in private browsing throws on `localStorage`, and a
throw here must degrade to "no timer", never to a broken session screen. A record that
fails to parse, fails a shape check, or carries a different `sessionId` is cleared and
reported absent. Same defensive shape as `requestPersistentStorage` in
`src/pwa/storage.ts`.

### `src/ui/session/restTone.ts` — new

```ts
export function unlockRestTone(): void;
export function playRestTone(): void;
```

WebAudio, no asset file and no `<audio>` element. `unlockRestTone()` lazily creates the
`AudioContext` and resumes it when suspended; `playRestTone()` is two short blips from an
`OscillatorNode` through a `GainNode` envelope, so it starts and stops without a click.

`unlockRestTone()` must be called as the **first statement** of the confirm handler,
before any `await`. iOS unlocks audio on a user gesture, and after an await the handler is
no longer running in the gesture's task. Getting this wrong produces a timer that is
silent on the first rest of every app launch and works forever after — the hardest
possible bug to reproduce.

Both functions no-op when `AudioContext` is undefined, which is the case in jsdom.

### `src/ui/useWakeLock.ts` — new

```ts
export function useWakeLock(shouldHold: boolean): void;
```

Acquires when `shouldHold` becomes true, releases when it becomes false or on unmount,
and drops its sentinel reference when the browser fires the lock's own `release` event.
It sits beside `useWriteError.ts` rather than under `session/` because keeping the screen
awake is not specific to rest.

### `src/ui/session/useRestTimer.ts` — new

```ts
export interface RestTimer {
  view: RestTimerView | null;
  start(restSeconds: number): void;
  clear(): void;
}

export function useRestTimer(sessionId: string | null, soundEnabled: boolean): RestTimer;
```

Owns the record state, a 500 ms display tick that runs only while a record exists, the
`visibilitychange` listener, the `toneAction` dispatch, and `useWakeLock(...)`. It applies
`isStaleRestTimer` when it loads a record and clears rather than adopts a stale one. It ticks
at 500 ms rather than 1000 ms because clock drift against a one-second display makes a
1000 ms tick sit on the same digit for nearly two seconds.

`sessionId` is nullable because **this hook is called before the screen's early
returns.** The Rules of Hooks require it: `ActiveSessionScreen` returns early for both
the loading and the no-session states, so the call site is immediately after
`useLiveQuery`, reading `data?.session.id ?? null` and
`data?.settings.restAlertSound ?? true`. Placing it after the guards breaks the screen on
the loading-to-loaded transition.

### `src/ui/session/RestBanner.tsx` — new, presentational

Takes a `RestTimerView` and an `onSkip`. Counting reads `Rest 1:24`; elapsed reads
`Rest done — 3:04 over`. The button is `Skip rest` while counting and `Dismiss` once
elapsed — one handler, two labels, because "skip" is a lie for something already over.

### `src/ui/session/PlannedSetRow.tsx` and `LoggedSetList.tsx` — extracted

No behaviour change. Both whole-branch reviewers on Plan 3 flagged
`ActiveSessionScreen.tsx` (~400 lines, five interaction modes in one render body) as a
split candidate and named Plan 4 as the forcing function. The extraction takes the screen
to roughly 280 lines and gives the banner somewhere to sit.

The existing session-screen tests must pass **unchanged** across this extraction. That is
the whole proof that it changed nothing.

## Wiring into `ActiveSessionScreen`

- `useRestTimer(...)` immediately after `useLiveQuery`, before the early returns.
- `unlockRestTone()` as the first statement of `confirmSet`.
- `timer.start(restSeconds)` inside the existing `if (wrote)` block — the timer starts
  only when the set actually persisted, using `item?.restSeconds ?? settings.defaultRestSeconds`,
  which the screen already computes.
- `timer.clear()` in `finish()` and `discard()`, gated on their existing `done` flags. A
  failed finish leaves the session open, and its timer with it.

`finish()` and `discard()` stay as they are otherwise. The handoff's deferred
`runThenNavigate(fn)` helper waits: this plan adds no new instance of the
`let done = false` idiom, and folding two five-line blocks into a helper while also
changing what they do would hide the change inside the refactor.

## Testing

`restTimerView`, `toneAction` and `shouldHoldWakeLock` take `now` as a parameter, so
their tests are table-driven and need no fake timers or mocks. That is most of the risk
covered by the cheapest possible tests.

Beyond those: a storage round-trip plus the corrupt-JSON, failing-shape, wrong-`sessionId`
and `localStorage`-throws cases; `useWakeLock` against a mocked `navigator.wakeLock`
asserting acquire, re-acquire and release; the banner's two phases; and integration on the
session screen — a confirmed set raises the banner, skip clears it, finish and discard
clear the record, and a failed write raises no timer.

`unlockRestTone` and `playRestTone` are asserted against a stubbed `AudioContext` for
call order and for the no-op path when the constructor is absent.

**Every test must be shown failing against unfixed code before it counts.** Plan 3
shipped four tests that could not fail. Implementers revert the fix and paste the failure.

## Task shape

1. `src/domain/restTimer.ts` — the four pure functions, the record type, the stale bound
2. `src/ui/session/restTimerStore.ts` — localStorage persistence
3. `src/ui/session/restTone.ts` — WebAudio unlock and tone
4. `src/ui/useWakeLock.ts` — the lock hook
5. Extract `PlannedSetRow` and `LoggedSetList`, existing tests unchanged
6. `src/ui/session/useRestTimer.ts` — wires 1–4
7. `RestBanner` and the `ActiveSessionScreen` wiring, with integration tests

Tasks 1, 3, 4 and 5 depend on nothing and can run in parallel. Task 2 needs the record
type from 1. Task 6 needs 1–4. Task 7 needs 5 and 6.

**No CSS in this plan.** Visual design stays deferred until the screens settle — which,
after this plan, they largely will have.

## Prerequisites

Both manual post-deploy checks from the Plan 3 handoff are still undone, and the second
is load-bearing here: *start a session, log a set, background Safari for a few minutes,
reopen — the logged set survives and the planned rows resume.* Run it before this plan
executes. If a backgrounded session does not survive today, the timer's resume behaviour
is being built on an assumption nobody has tested.

## Out of scope

- The `shortcuts://run-shortcut` URL scheme for native background alerts. Untested,
  optional if it ever ships, and recorded in the parent spec's Deferred section.
- ±30 s adjustment of a running timer. The rest value's durable home is the routine item.
- A mute control and the Settings screen — Plan 6, with backup.
- Web Push, the `playback` audio category, and pre-rendered audio. All three measured and
  rejected by the spike; do not re-litigate.
- History browse and edit, PR detection — Plan 5.

## Inherited constraints

The constraint list in `HANDOFF-2026-09-04-plan-4-rest-timer.md` applies unchanged and is
not restated here. The four that bear directly on this plan:

- A `liveQuery` querier may not open a readwrite transaction. This plan writes nothing to
  Dexie at all, so the querier is untouched.
- One querier per screen. The timer adds no second `useLiveQuery`; it reads
  `restAlertSound` from the data the existing querier already returns.
- `run(...)` never rejects, so a write's outcome is known only through a local flag. The
  timer starts inside `if (wrote)` for exactly this reason.
- `src/domain/` is pure and I/O-free. `restTimer.ts` performs no I/O and imports no
  database module.
