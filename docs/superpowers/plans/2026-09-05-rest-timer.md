# Rest Timer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completing a set starts a timestamp-based rest countdown that keeps the screen awake while it runs and plays a tone when it ends, and that tells the user how long ago rest ended when they come back late.

**Architecture:** All arithmetic and every decision rule is a pure function in `src/domain/restTimer.ts` taking `now` as a parameter, so it is testable at an exact instant with no fake timers and no mocks. Three thin side-effect modules sit under it — localStorage persistence, a WebAudio tone, a Wake Lock hook — and one hook wires them together for one presentational banner. No Dexie writes, no schema change, no second `useLiveQuery`.

**Tech Stack:** React 19, TypeScript 7, Vitest 4 + jsdom 30, @testing-library/react 16 (`render`, `renderHook`, `screen`, `waitFor`) and user-event 14. Browser APIs: `localStorage`, `navigator.wakeLock`, WebAudio. All are typed in this toolchain — verified by compiling a probe against `tsc --noEmit` before this plan was written.

**Spec:** `docs/superpowers/specs/2026-09-05-rest-timer-design.md`

## Global Constraints

- **Node/PATH:** use Git Bash, not PowerShell. If `node` is missing: `export PATH="/c/Program Files/nodejs:$PATH"`.
- **Full-suite command:** `npx vitest run --fileParallelism=false`. Parallel runs are flaky in this sandbox. Baseline before this plan is **25 files / 355 tests**. A run reporting roughly double that means a worktree is being collected — a red flag, not a bonus.
- **Single-file command:** `npx vitest run <path>` is fine and is what each task uses.
- **Vitest globals are enabled.** Do NOT import `describe` / `it` / `expect` / `beforeEach` / `vi`.
- **`src/domain/` is pure and I/O-free.** Type-only imports from `src/db/types` are allowed; a runtime database import is not.
- **This plan writes nothing to Dexie.** No schema change, no migration, no new `useLiveQuery`.
- **One querier per screen.** `restAlertSound` comes from the data the existing querier already returns. Do not add a second `useLiveQuery`.
- **`run(...)` from `src/ui/useWriteError.ts` never rejects** — execution continues after a failed write. A write's outcome is known only through a local flag set inside the closure.
- **Reuse `formatDuration(seconds)` from `src/domain/measurement.ts`.** It renders `m:ss` and is already tested. Do not write a second one.
- **No CSS in this plan.** Class names are fine; stylesheets are not.
- **Every test must be shown failing before its implementation lands.** Plan 3 shipped four tests that could not fail. Each task below has an explicit "verify it fails" step with the expected failure text; if a test passes at that step, the test is wrong — fix the test, do not proceed.
- **Commit at the end of every task.** End commit messages with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

---

## File Structure

**Created:**

| File | Responsibility |
| --- | --- |
| `src/domain/restTimer.ts` | Pure: the record type, the countdown, the tone decision, the lock condition, the staleness bound |
| `src/domain/restTimer.test.ts` | Table-driven tests for all four functions |
| `src/ui/session/restTimerStore.ts` | localStorage read/write/clear, fully guarded |
| `src/ui/session/restTimerStore.test.ts` | Round-trip plus every corrupt/hostile-storage path |
| `src/ui/session/restTone.ts` | WebAudio unlock + two-blip tone |
| `src/ui/session/restTone.test.ts` | Against a stubbed `AudioContext` |
| `src/ui/useWakeLock.ts` | Holds a screen wake lock while a boolean is true |
| `src/ui/useWakeLock.test.ts` | Against a mocked `navigator.wakeLock` |
| `src/ui/session/useRestTimer.ts` | Wires store + tone + lock + tick + visibility |
| `src/ui/session/useRestTimer.test.ts` | Hook behaviour with fake timers |
| `src/ui/session/PlannedSetRow.tsx` | One unconfirmed row: fields, warm-up toggle, confirm |
| `src/ui/session/LoggedSetList.tsx` | The confirmed-set list with its remove controls |
| `src/ui/session/RestBanner.tsx` | Presentational: counting or elapsed, plus one button |
| `src/ui/session/RestBanner.test.tsx` | Both phases |

**Modified:**

| File | Change |
| --- | --- |
| `src/ui/session/ActiveSessionScreen.tsx` | Extraction (Task 5), then timer wiring (Task 7) |
| `src/ui/session/ActiveSessionScreen.test.tsx` | `localStorage.clear()` in `beforeEach`, plus four integration tests (Task 7) |

**Dependency order:** Tasks 1, 3, 4 and 5 depend on nothing and may run in parallel. Task 2 needs Task 1's `RestTimerRecord`. Task 6 needs 1–4. Task 7 needs 5 and 6.

---

### Task 1: Pure rest-timer rules

**Files:**
- Create: `src/domain/restTimer.ts`
- Test: `src/domain/restTimer.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface RestTimerRecord { sessionId: string; endsAt: number; restSeconds: number; firedAt: number | null }`
  - `type RestTimerView = { phase: 'counting'; remainingSeconds: number } | { phase: 'elapsed'; overrunSeconds: number }`
  - `type ToneAction = 'play' | 'suppress' | 'none'`
  - `const STALE_OVERRUN_SECONDS: number`
  - `restTimerView(record: RestTimerRecord, now: number): RestTimerView`
  - `toneAction(record: RestTimerRecord, now: number, trigger: 'tick' | 'became-visible', visible: boolean): ToneAction`
  - `shouldHoldWakeLock(record: RestTimerRecord | null, now: number, visible: boolean): boolean`
  - `isStaleRestTimer(record: RestTimerRecord, now: number): boolean`

- [ ] **Step 1: Write the failing tests**

Create `src/domain/restTimer.test.ts`:

```ts
import {
  isStaleRestTimer,
  restTimerView,
  shouldHoldWakeLock,
  toneAction,
  STALE_OVERRUN_SECONDS,
  type RestTimerRecord,
} from './restTimer';

const T0 = 1_700_000_000_000;

function record(over: Partial<RestTimerRecord> = {}): RestTimerRecord {
  return { sessionId: 's1', endsAt: T0 + 90_000, restSeconds: 90, firedAt: null, ...over };
}

describe('restTimerView', () => {
  it('reads the full rest at the instant it starts', () => {
    expect(restTimerView(record(), T0)).toEqual({ phase: 'counting', remainingSeconds: 90 });
  });

  it('rounds a part second up, so the number promised is the number shown', () => {
    // Floor would render 1:29 one millisecond into a 90 s rest.
    expect(restTimerView(record(), T0 + 1)).toEqual({ phase: 'counting', remainingSeconds: 90 });
  });

  it('counts down', () => {
    expect(restTimerView(record(), T0 + 60_000)).toEqual({
      phase: 'counting',
      remainingSeconds: 30,
    });
  });

  it('turns elapsed at the deadline rather than resting on a final zero', () => {
    expect(restTimerView(record(), T0 + 90_000)).toEqual({ phase: 'elapsed', overrunSeconds: 0 });
  });

  it('counts the overrun up, because returning late is the normal flow', () => {
    expect(restTimerView(record(), T0 + 274_000)).toEqual({
      phase: 'elapsed',
      overrunSeconds: 184,
    });
  });
});

describe('toneAction', () => {
  it('stays silent while rest is still running', () => {
    expect(toneAction(record(), T0 + 1_000, 'tick', true)).toBe('none');
  });

  it('plays when the deadline passes with the document visible', () => {
    expect(toneAction(record(), T0 + 90_000, 'tick', true)).toBe('play');
  });

  it('suppresses when the app comes back to find rest already over', () => {
    // The spike settled that no sound can reach a backgrounded app on iOS.
    // A beep three minutes late reads as "rest just ended" when it did not.
    expect(toneAction(record(), T0 + 270_000, 'became-visible', true)).toBe('suppress');
  });

  it('does not beep into a hidden document', () => {
    // Reachable off iOS: jsdom and desktop browsers keep intervals running
    // while hidden. Leaving the record unfired here is what lets the
    // became-visible path suppress it on return.
    expect(toneAction(record(), T0 + 90_000, 'tick', false)).toBe('none');
  });

  it('does not suppress a return that lands before the deadline', () => {
    expect(toneAction(record(), T0 + 10_000, 'became-visible', true)).toBe('none');
  });

  it('fires once and once only, by either route', () => {
    const fired = record({ firedAt: T0 + 90_000 });
    expect(toneAction(fired, T0 + 91_000, 'tick', true)).toBe('none');
    expect(toneAction(fired, T0 + 91_000, 'became-visible', true)).toBe('none');
  });
});

describe('shouldHoldWakeLock', () => {
  it('holds while counting down in a visible document', () => {
    expect(shouldHoldWakeLock(record(), T0 + 1_000, true)).toBe(true);
  });

  it('holds nothing when there is no timer', () => {
    expect(shouldHoldWakeLock(null, T0, true)).toBe(false);
  });

  it('does not hold while hidden, which is when iOS drops it anyway', () => {
    expect(shouldHoldWakeLock(record(), T0 + 1_000, false)).toBe(false);
  });

  it('releases at elapse, so a forgotten timer cannot hold the screen awake', () => {
    // A deliberate deviation from the parent spec's "releases when the next
    // set is logged": that lifecycle keeps re-acquiring on every return to
    // visibility for a session the user walked away from.
    expect(shouldHoldWakeLock(record(), T0 + 90_000, true)).toBe(false);
  });
});

describe('isStaleRestTimer', () => {
  it('keeps a rest that has only just run over', () => {
    expect(isStaleRestTimer(record(), T0 + 90_000 + 60_000)).toBe(false);
  });

  it('is never stale before its own deadline', () => {
    expect(isStaleRestTimer(record(), T0)).toBe(false);
  });

  it('drops one abandoned long enough that m:ss would render nonsense', () => {
    // formatDuration has no hours field by design, so a session left open
    // overnight would otherwise show "Rest done — 743:12 over".
    const at = T0 + 90_000 + (STALE_OVERRUN_SECONDS + 1) * 1000;
    expect(isStaleRestTimer(record(), at)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/domain/restTimer.test.ts`
Expected: FAIL — the suite cannot resolve `./restTimer`; the reported error is `Failed to load url ./restTimer` or `Cannot find module`.

- [ ] **Step 3: Write the implementation**

Create `src/domain/restTimer.ts`:

```ts
/**
 * The rest timer's rules, as pure functions of a stored deadline and a clock
 * reading.
 *
 * `now` is a parameter rather than a Date.now() call inside, for two reasons.
 * It makes every rule here testable at an exact instant without fake timers.
 * And it is the shape the platform forces: iOS suspends intervals in a
 * backgrounded tab — a 30 s setInterval was measured firing at 81 s — so the
 * timer must recompute from a deadline rather than trust accumulated ticks.
 * See docs/superpowers/spikes/2026-08-04-rest-alert-reach.md.
 */

export interface RestTimerRecord {
  /** The session this rest belongs to. A record carrying any other id belongs
   *  to a workout that was finished, discarded, or replaced. */
  sessionId: string;
  /** Epoch ms at which rest is over. */
  endsAt: number;
  /** What was prescribed, kept for the banner's label. */
  restSeconds: number;
  /** Epoch ms the tone fired or was deliberately suppressed; null until then. */
  firedAt: number | null;
}

export type RestTimerView =
  | { phase: 'counting'; remainingSeconds: number }
  | { phase: 'elapsed'; overrunSeconds: number };

export type ToneAction = 'play' | 'suppress' | 'none';

/** Past this the user is not resting between sets, they left. */
export const STALE_OVERRUN_SECONDS = 30 * 60;

export function restTimerView(record: RestTimerRecord, now: number): RestTimerView {
  const remainingMs = record.endsAt - now;
  if (remainingMs > 0) {
    // Ceil: a 2:00 rest must read 2:00 at the instant it starts, not 1:59.
    return { phase: 'counting', remainingSeconds: Math.ceil(remainingMs / 1000) };
  }
  // Floor: overrun counts up from zero.
  return { phase: 'elapsed', overrunSeconds: Math.floor(-remainingMs / 1000) };
}

/**
 * Whether this observation of the clock should make a sound, mark the timer
 * fired silently, or do nothing.
 *
 * 'suppress' and 'play' both mark the record fired; only 'play' reaches the
 * speaker. Muting is applied by the caller at the speaker, never here, so a
 * silenced timer and an audible one advance through identical states.
 */
export function toneAction(
  record: RestTimerRecord,
  now: number,
  trigger: 'tick' | 'became-visible',
  visible: boolean,
): ToneAction {
  if (record.firedAt !== null) return 'none';
  if (now < record.endsAt) return 'none';
  // The deadline was crossed while the document was hidden. iOS could not
  // have played anything then, and playing now would arrive minutes late for
  // something already on screen.
  if (trigger === 'became-visible') return 'suppress';
  // A tick in a hidden document is reachable off iOS, where intervals keep
  // running. Firing would beep into a locked phone; leaving it unfired lets
  // the became-visible path suppress it correctly on return.
  if (!visible) return 'none';
  return 'play';
}

/**
 * The lock is held exactly while a timer is counting down in a visible
 * document — one condition, no lifecycle.
 *
 * Releasing at elapse deviates from the parent spec's "releases it when the
 * next set is logged". Because the lock is re-acquired on every return to
 * visibility, that lifecycle would keep re-acquiring for a session the user
 * walked away from. The cost is accepted: at 0:00 the screen may sleep on
 * iOS's normal timeout, and the overrun is still there when it wakes.
 */
export function shouldHoldWakeLock(
  record: RestTimerRecord | null,
  now: number,
  visible: boolean,
): boolean {
  if (record === null) return false;
  if (!visible) return false;
  return now < record.endsAt;
}

/**
 * A record can go stale in time as well as in identity. Someone resuming a
 * session the next morning would otherwise meet a banner reading
 * "Rest done — 743:12 over", because formatDuration renders m:ss with no
 * hours field.
 */
export function isStaleRestTimer(record: RestTimerRecord, now: number): boolean {
  return now - record.endsAt > STALE_OVERRUN_SECONDS * 1000;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/domain/restTimer.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Commit**

```bash
git add src/domain/restTimer.ts src/domain/restTimer.test.ts
git commit -m "feat: add the rest timer's pure rules"
```

---

### Task 2: localStorage persistence

**Files:**
- Create: `src/ui/session/restTimerStore.ts`
- Test: `src/ui/session/restTimerStore.test.ts`

**Interfaces:**
- Consumes: `RestTimerRecord` from `src/domain/restTimer` (Task 1), type-only.
- Produces:
  - `const REST_TIMER_KEY: string`
  - `readRestTimer(sessionId: string): RestTimerRecord | null`
  - `writeRestTimer(record: RestTimerRecord): void`
  - `clearRestTimer(): void`

Staleness is **not** applied here. This module is a dumb store; `useRestTimer` (Task 6) applies `isStaleRestTimer` when it loads.

- [ ] **Step 1: Write the failing tests**

Create `src/ui/session/restTimerStore.test.ts`:

```ts
import type { RestTimerRecord } from '../../domain/restTimer';
import {
  clearRestTimer,
  readRestTimer,
  writeRestTimer,
  REST_TIMER_KEY,
} from './restTimerStore';

const stored: RestTimerRecord = {
  sessionId: 's1',
  endsAt: 1_700_000_090_000,
  restSeconds: 90,
  firedAt: null,
};

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it('round-trips a record', () => {
  writeRestTimer(stored);
  expect(readRestTimer('s1')).toEqual(stored);
});

it('reports no timer when nothing was written', () => {
  expect(readRestTimer('s1')).toBeNull();
});

it('clears a record on request', () => {
  writeRestTimer(stored);
  clearRestTimer();
  expect(readRestTimer('s1')).toBeNull();
});

it('refuses a record left behind by another session, and clears it', () => {
  writeRestTimer(stored);
  expect(readRestTimer('another-session')).toBeNull();
  // Cleared rather than merely ignored: left in place, it would be adopted
  // the moment a session with the matching id came back into view.
  expect(localStorage.getItem(REST_TIMER_KEY)).toBeNull();
});

it('discards a corrupt entry rather than parsing NaN into the countdown', () => {
  localStorage.setItem(REST_TIMER_KEY, '{not json');
  expect(readRestTimer('s1')).toBeNull();
  expect(localStorage.getItem(REST_TIMER_KEY)).toBeNull();
});

it('discards an entry that parses but is the wrong shape', () => {
  // Written by an older build, or by something else on the origin. Adopting
  // it would render "Rest NaN:NaN".
  localStorage.setItem(REST_TIMER_KEY, JSON.stringify({ sessionId: 's1', endsAt: 'soon' }));
  expect(readRestTimer('s1')).toBeNull();
  expect(localStorage.getItem(REST_TIMER_KEY)).toBeNull();
});

it('accepts a record that has already fired', () => {
  const fired = { ...stored, firedAt: 1_700_000_090_000 };
  writeRestTimer(fired);
  expect(readRestTimer('s1')).toEqual(fired);
});

it('reports no timer when localStorage itself throws', () => {
  // Safari in private browsing. A session screen that will not render is a
  // far worse outcome than a lost countdown.
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('access denied');
  });
  expect(() => readRestTimer('s1')).not.toThrow();
  expect(readRestTimer('s1')).toBeNull();
});

it('does not throw when a write is refused', () => {
  // Never fail a set log over a countdown that could not be persisted.
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota exceeded');
  });
  expect(() => writeRestTimer(stored)).not.toThrow();
});

it('does not throw when a clear is refused', () => {
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new Error('access denied');
  });
  expect(() => clearRestTimer()).not.toThrow();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ui/session/restTimerStore.test.ts`
Expected: FAIL — cannot resolve `./restTimerStore`.

- [ ] **Step 3: Write the implementation**

Create `src/ui/session/restTimerStore.ts`:

```ts
import type { RestTimerRecord } from '../../domain/restTimer';

export const REST_TIMER_KEY = 'workout-tracker:rest-timer';

/**
 * The running rest, kept outside Dexie.
 *
 * A rest interval is transient UI state. Putting it on the Session row would
 * push it into the backup format, into history rendering, and into every
 * future reader that would then have to learn to ignore it. localStorage
 * rather than React state because an installed iOS PWA often cold-reloads on
 * resume rather than merely suspending, which loses the timer in exactly the
 * long-rest case that needs it most.
 *
 * Every access is guarded. Safari in private browsing throws on localStorage,
 * and a throw here must degrade to "no timer", never to a session screen that
 * will not render.
 */

function isRecord(value: unknown): value is RestTimerRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.sessionId === 'string' &&
    typeof r.endsAt === 'number' &&
    typeof r.restSeconds === 'number' &&
    (r.firedAt === null || typeof r.firedAt === 'number')
  );
}

export function readRestTimer(sessionId: string): RestTimerRecord | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(REST_TIMER_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearRestTimer();
    return null;
  }

  // A record failing the shape check was written by a different build, or by
  // something else on this origin. A mismatched session id belongs to a
  // workout that is over. Both are cleared rather than ignored, so neither
  // can be adopted later.
  if (!isRecord(parsed) || parsed.sessionId !== sessionId) {
    clearRestTimer();
    return null;
  }
  return parsed;
}

export function writeRestTimer(record: RestTimerRecord): void {
  try {
    localStorage.setItem(REST_TIMER_KEY, JSON.stringify(record));
  } catch {
    // Storage full or unavailable. The timer still runs from memory for as
    // long as the page lives; only surviving a reload is lost, and that is
    // not worth failing a set log over.
  }
}

export function clearRestTimer(): void {
  try {
    localStorage.removeItem(REST_TIMER_KEY);
  } catch {
    // Nothing to do: the reader already treats an unreadable store as empty.
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/ui/session/restTimerStore.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/session/restTimerStore.ts src/ui/session/restTimerStore.test.ts
git commit -m "feat: persist the running rest outside Dexie"
```

---

### Task 3: The rest-over tone

**Files:**
- Create: `src/ui/session/restTone.ts`
- Test: `src/ui/session/restTone.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `unlockRestTone(): void` — call from inside a user gesture, before any `await`
  - `playRestTone(): void`
  - `resetRestToneForTests(): void`

- [ ] **Step 1: Write the failing tests**

Create `src/ui/session/restTone.test.ts`:

```ts
import { playRestTone, resetRestToneForTests, unlockRestTone } from './restTone';

interface StubOscillator {
  type: string;
  frequency: { value: number };
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

function stubAudio(initialState: 'running' | 'suspended' = 'running') {
  const oscillators: StubOscillator[] = [];
  const context = {
    state: initialState,
    currentTime: 0,
    destination: {},
    resume: vi.fn(async () => {
      context.state = 'running';
    }),
    createOscillator: vi.fn(() => {
      const osc: StubOscillator = {
        type: '',
        frequency: { value: 0 },
        // osc.connect(gain).connect(destination) — the first connect must
        // return something connectable.
        connect: vi.fn(() => ({ connect: vi.fn() })),
        start: vi.fn(),
        stop: vi.fn(),
      };
      oscillators.push(osc);
      return osc;
    }),
    createGain: vi.fn(() => ({
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    })),
  };
  const ctor = vi.fn(() => context);
  vi.stubGlobal('AudioContext', ctor);
  return { context, ctor, oscillators };
}

beforeEach(() => {
  resetRestToneForTests();
  vi.unstubAllGlobals();
});

it('creates one audio context however many times the gesture fires', () => {
  const { ctor } = stubAudio();
  unlockRestTone();
  unlockRestTone();
  unlockRestTone();
  expect(ctor).toHaveBeenCalledTimes(1);
});

it('resumes a context iOS suspended while the app was backgrounded', () => {
  const { context } = stubAudio('suspended');
  unlockRestTone();
  expect(context.resume).toHaveBeenCalled();
});

it('does nothing when the browser has no AudioContext', () => {
  // jsdom, and any browser old enough to lack it. A silent timer beats a
  // session screen that throws.
  vi.stubGlobal('AudioContext', undefined);
  expect(() => unlockRestTone()).not.toThrow();
  expect(() => playRestTone()).not.toThrow();
});

it('makes no sound before the gesture has unlocked audio', () => {
  const { context } = stubAudio();
  playRestTone();
  expect(context.createOscillator).not.toHaveBeenCalled();
});

it('plays two blips once unlocked', () => {
  // Two rather than one: a single beep in a noisy gym reads as incidental.
  const { oscillators } = stubAudio();
  unlockRestTone();
  playRestTone();
  expect(oscillators).toHaveLength(2);
  expect(oscillators[0].frequency.value).toBeGreaterThan(0);
  expect(oscillators[1].frequency.value).not.toBe(oscillators[0].frequency.value);
  for (const osc of oscillators) {
    expect(osc.start).toHaveBeenCalled();
    expect(osc.stop).toHaveBeenCalled();
  }
});

it('stays silent when the context is not running', () => {
  const { context, oscillators } = stubAudio();
  unlockRestTone();
  context.state = 'suspended';
  expect(() => playRestTone()).not.toThrow();
  expect(oscillators).toHaveLength(0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ui/session/restTone.test.ts`
Expected: FAIL — cannot resolve `./restTone`.

- [ ] **Step 3: Write the implementation**

Create `src/ui/session/restTone.ts`:

```ts
/**
 * The rest-over tone.
 *
 * WebAudio rather than an <audio> element and a bundled file: nothing to
 * ship, no element to prime, and a gain envelope that starts and stops the
 * blip without a click.
 *
 * This is the foreground half only. The spike
 * (docs/superpowers/spikes/2026-08-04-rest-alert-reach.md) measured that
 * nothing here can reach a backgrounded app on iOS — the audio clock itself
 * is suspended — so no amount of scheduling ahead would help.
 */

type AudioContextCtor = typeof AudioContext;

let context: AudioContext | null = null;

function audioContextCtor(): AudioContextCtor | null {
  const g = globalThis as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

/**
 * Must be called from inside a user gesture, before any await.
 *
 * iOS unlocks audio on a gesture and suspends the context whenever the app is
 * backgrounded, so calling this on every confirm tap is what leaves the
 * context running when the tone fires ninety seconds later. Calling it after
 * an await instead produces a timer that is silent on the first rest of every
 * launch and works forever after — the hardest possible bug to reproduce.
 */
export function unlockRestTone(): void {
  try {
    const Ctor = audioContextCtor();
    if (!Ctor) return;
    context ??= new Ctor();
    if (context.state === 'suspended') void context.resume();
  } catch {
    // A context the browser refuses to create is not a reason to fail a set
    // log.
  }
}

export function playRestTone(): void {
  try {
    if (!context || context.state !== 'running') return;
    const startedAt = context.currentTime;
    // Two short blips rather than one long one: a single beep in a noisy gym
    // reads as incidental, a pair reads as deliberate.
    const blips = [
      { at: startedAt, hz: 880 },
      { at: startedAt + 0.18, hz: 1174 },
    ];
    for (const blip of blips) {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = 'sine';
      osc.frequency.value = blip.hz;
      // Ramped rather than switched, so neither end of the blip clicks.
      // Exponential ramps cannot touch zero, hence 0.0001.
      gain.gain.setValueAtTime(0.0001, blip.at);
      gain.gain.exponentialRampToValueAtTime(0.3, blip.at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, blip.at + 0.12);
      osc.connect(gain).connect(context.destination);
      osc.start(blip.at);
      osc.stop(blip.at + 0.14);
    }
  } catch {
    // A tone that will not play leaves a silent timer, not a broken one.
  }
}

/** Test seam: drops the cached context so each test starts locked. */
export function resetRestToneForTests(): void {
  context = null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/ui/session/restTone.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/session/restTone.ts src/ui/session/restTone.test.ts
git commit -m "feat: add the rest-over tone"
```

---

### Task 4: The wake lock hook

**Files:**
- Create: `src/ui/useWakeLock.ts`
- Test: `src/ui/useWakeLock.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `useWakeLock(shouldHold: boolean): void`

It lives beside `useWriteError.ts` rather than under `session/` because keeping the screen awake is not specific to rest. `navigator.wakeLock`, `WakeLockSentinel` and `sentinel.release()` are all typed in this toolchain — verified with `tsc --noEmit` before this plan was written, so no `any` and no local shim are needed.

- [ ] **Step 1: Write the failing tests**

Create `src/ui/useWakeLock.test.ts`:

```ts
import { renderHook } from '@testing-library/react';
import { useWakeLock } from './useWakeLock';

function stubWakeLock() {
  const listeners: Array<() => void> = [];
  const sentinel = {
    release: vi.fn(async () => {}),
    addEventListener: vi.fn((event: string, handler: () => void) => {
      if (event === 'release') listeners.push(handler);
    }),
  };
  const request = vi.fn(async () => sentinel);
  Object.defineProperty(navigator, 'wakeLock', {
    value: { request },
    configurable: true,
  });
  /** Fire the browser's own release, which iOS does whenever the page hides. */
  const fireRelease = () => listeners.forEach((h) => h());
  return { sentinel, request, fireRelease };
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'wakeLock');
});

it('acquires a lock when the condition turns true', async () => {
  const { request } = stubWakeLock();
  const { rerender } = renderHook(({ hold }) => useWakeLock(hold), {
    initialProps: { hold: false },
  });
  expect(request).not.toHaveBeenCalled();

  rerender({ hold: true });
  await vi.waitFor(() => expect(request).toHaveBeenCalledWith('screen'));
});

it('releases when the condition turns false', async () => {
  const { sentinel } = stubWakeLock();
  const { rerender } = renderHook(({ hold }) => useWakeLock(hold), {
    initialProps: { hold: true },
  });
  await vi.waitFor(() => expect(sentinel.addEventListener).toHaveBeenCalled());

  rerender({ hold: false });
  await vi.waitFor(() => expect(sentinel.release).toHaveBeenCalled());
});

it('releases on unmount, so a lock cannot outlive the screen', async () => {
  const { sentinel } = stubWakeLock();
  const { unmount } = renderHook(() => useWakeLock(true));
  await vi.waitFor(() => expect(sentinel.addEventListener).toHaveBeenCalled());

  unmount();
  await vi.waitFor(() => expect(sentinel.release).toHaveBeenCalled());
});

it('does not acquire a second lock while it already holds one', async () => {
  const { request } = stubWakeLock();
  const { rerender } = renderHook(({ hold }) => useWakeLock(hold), {
    initialProps: { hold: true },
  });
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));

  rerender({ hold: true });
  rerender({ hold: true });
  expect(request).toHaveBeenCalledTimes(1);
});

it('can acquire again after the browser released the lock itself', async () => {
  // iOS drops the lock whenever the document hides and never restores it.
  // Without clearing the stored sentinel, the next acquire would be skipped
  // because the hook still believed it held one.
  const { request, fireRelease } = stubWakeLock();
  const { rerender } = renderHook(({ hold }) => useWakeLock(hold), {
    initialProps: { hold: true },
  });
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));

  fireRelease();
  rerender({ hold: false });
  rerender({ hold: true });
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
});

it('does nothing when the browser has no Wake Lock API', () => {
  // jsdom has none. A missing lock means the screen sleeps normally, which is
  // not worth surfacing to someone mid-set.
  expect(() => renderHook(() => useWakeLock(true))).not.toThrow();
});

it('survives a rejected request', async () => {
  // The API rejects when the document is not visible.
  const request = vi.fn(async () => {
    throw new Error('not allowed');
  });
  Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
  expect(() => renderHook(() => useWakeLock(true))).not.toThrow();
  await vi.waitFor(() => expect(request).toHaveBeenCalled());
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ui/useWakeLock.test.ts`
Expected: FAIL — cannot resolve `./useWakeLock`.

- [ ] **Step 3: Write the implementation**

Create `src/ui/useWakeLock.ts`:

```ts
import { useEffect, useRef } from 'react';

/**
 * Holds a Screen Wake Lock for as long as `shouldHold` is true.
 *
 * Deliberately dumb: the caller owns the condition. The rest timer's version
 * of it lives in src/domain/restTimer.ts as shouldHoldWakeLock, where it is
 * testable without a browser.
 *
 * Best-effort throughout. navigator.wakeLock is absent in jsdom and rejects
 * when the document is not visible; either way the screen simply sleeps on
 * its normal timeout, which is not worth surfacing to someone mid-set.
 *
 * iOS releases the lock whenever the document hides and never restores it, so
 * re-acquisition matters. It happens naturally here: visibility is part of
 * the caller's condition, and a visibility change re-renders.
 */
export function useWakeLock(shouldHold: boolean): void {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    let cancelled = false;

    function release() {
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      // Nothing to do about a failed release: the lock is the browser's, and
      // a rejection here means it is already gone.
      if (sentinel) void sentinel.release().catch(() => {});
    }

    async function acquire() {
      if (sentinelRef.current) return;
      try {
        const sentinel = await navigator.wakeLock?.request('screen');
        if (!sentinel) return;
        if (cancelled) {
          // The condition went false while the request was in flight.
          // Releasing rather than storing keeps a lock from outliving it.
          void sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
        // The browser drops the lock on its own when the document hides.
        // Without this the ref would keep a dead sentinel and the next
        // acquire would be skipped as redundant.
        sentinel.addEventListener('release', () => {
          sentinelRef.current = null;
        });
      } catch {
        // No lock. Nothing else changes.
      }
    }

    if (shouldHold) void acquire();
    else release();

    return () => {
      cancelled = true;
      release();
    };
  }, [shouldHold]);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/ui/useWakeLock.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/useWakeLock.ts src/ui/useWakeLock.test.ts
git commit -m "feat: add a screen wake lock hook"
```

---

### Task 5: Extract PlannedSetRow and LoggedSetList

**Files:**
- Create: `src/ui/session/PlannedSetRow.tsx`
- Create: `src/ui/session/LoggedSetList.tsx`
- Modify: `src/ui/session/ActiveSessionScreen.tsx`

**Interfaces:**
- Consumes: `PlannedSet` from `src/domain/setPlan`, `SetFieldSpec` and `formatSet` from `src/domain/measurement`, `LoggedSet` and `MeasurementType` from `src/db/types`.
- Produces: `PlannedSetRow` and `LoggedSetList` components (props below).

**This task changes no behaviour.** `src/ui/session/ActiveSessionScreen.test.tsx` must pass **unchanged** — do not edit that file in this task. Every rendered string, `aria-label`, `role` and `className` must survive byte-for-byte, because those tests are the only proof the extraction was faithful.

Both whole-branch reviewers on Plan 3 named this file (~400 lines, five interaction modes in one render body) as a split candidate and named Plan 4 as the forcing function. This is that split, done before the timer lands so the banner has somewhere to sit.

- [ ] **Step 1: Record the baseline**

Run: `npx vitest run src/ui/session/ActiveSessionScreen.test.tsx`
Expected: PASS, 26 tests. Note the number; it must be identical at Step 5.

- [ ] **Step 2: Create `LoggedSetList`**

Create `src/ui/session/LoggedSetList.tsx`. This is the `<ol className="logged-sets">` block lifted verbatim:

```tsx
import { formatSet } from '../../domain/measurement';
import type { LoggedSet, MeasurementType } from '../../db/types';

interface LoggedSetListProps {
  sets: LoggedSet[];
  measurementType: MeasurementType;
  onRemove: (setId: string) => void;
}

/**
 * The confirmed sets for the focused exercise.
 *
 * Display numbering is the position in this sorted array, not LoggedSet.order
 * — that is a monotonic sort key which deliberately leaves a gap when a set is
 * deleted.
 */
export function LoggedSetList({ sets, measurementType, onRemove }: LoggedSetListProps) {
  return (
    <ol className="logged-sets">
      {sets.map((set, index) => (
        <li key={set.id}>
          <span>
            {index + 1}. {formatSet(set, measurementType)}
            {set.setType === 'warmup' && ' (warm-up)'}
          </span>
          <button
            type="button"
            aria-label={`Remove logged set ${index + 1}`}
            onClick={() => onRemove(set.id)}
          >
            Remove
          </button>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 3: Create `PlannedSetRow`**

Create `src/ui/session/PlannedSetRow.tsx`. This is the body of the `<ol className="planned-sets">` map, lifted verbatim:

```tsx
import type { SetFieldSpec } from '../../domain/measurement';
import type { PlannedSet } from '../../domain/setPlan';

interface PlannedSetRowProps {
  row: PlannedSet;
  fields: SetFieldSpec[];
  /** The string to show for one field: the user's draft when they have typed
   *  one, otherwise the prefilled value. Bound to this row by the caller. */
  valueFor: (property: SetFieldSpec['property']) => string;
  onFieldChange: (property: SetFieldSpec['property'], value: string) => void;
  isWarmup: boolean;
  onWarmupChange: (checked: boolean) => void;
  /** True while this row's own write is in flight. */
  busy: boolean;
  onConfirm: () => void;
}

/**
 * One unconfirmed row. Nothing here reaches the sets table until the confirm
 * button is tapped — planned rows are UI state, which is what keeps PR
 * detection, volume and the backup format from ever having to filter out sets
 * that were not performed.
 */
export function PlannedSetRow({
  row,
  fields,
  valueFor,
  onFieldChange,
  isWarmup,
  onWarmupChange,
  busy,
  onConfirm,
}: PlannedSetRowProps) {
  return (
    <li>
      {fields.map((field) => (
        <label key={field.property}>
          {field.label}
          {field.unitBearing ? ` (${row.unit})` : ''}
          <input
            type="number"
            aria-label={`${field.label} for set ${row.position}`}
            value={valueFor(field.property)}
            onChange={(e) => onFieldChange(field.property, e.target.value)}
          />
        </label>
      ))}

      <label>
        Warm-up
        <input
          type="checkbox"
          aria-label={`Mark set ${row.position} as a warm-up`}
          checked={isWarmup}
          onChange={(e) => onWarmupChange(e.target.checked)}
        />
      </label>

      <button
        type="button"
        // Disabled while its own write is in flight. Two fast taps would
        // otherwise log the set twice; logSet's transactional order
        // assignment keeps them distinct, but the second set is still one the
        // user did not perform.
        disabled={busy}
        onClick={onConfirm}
      >
        Log set {row.position}
      </button>
    </li>
  );
}
```

- [ ] **Step 4: Rewrite the two blocks in `ActiveSessionScreen.tsx` to use them**

Add to the imports:

```tsx
import { LoggedSetList } from './LoggedSetList';
import { PlannedSetRow } from './PlannedSetRow';
```

Replace the whole `<ol className="logged-sets">…</ol>` block with:

```tsx
      <LoggedSetList
        sets={logged}
        measurementType={exercise.measurementType}
        onRemove={(setId) => run(() => deleteSet(setId))}
      />
```

Replace the whole `<ol className="planned-sets">…</ol>` block with:

```tsx
      <ol className="planned-sets">
        {planned.map((row) => (
          <PlannedSetRow
            key={row.position}
            row={row}
            fields={fields}
            // Bound to this row here, so the row component never needs to
            // know how prefill and drafts are layered.
            valueFor={(property) => valueFor(row, property, row[property])}
            onFieldChange={(property, value) =>
              setDrafts((d) => ({ ...d, [draftKey(row.position, property)]: value }))
            }
            isWarmup={warmup[`${focused}:${row.position}`] ?? false}
            onWarmupChange={(checked) =>
              setWarmup((w) => ({ ...w, [`${focused}:${row.position}`]: checked }))
            }
            busy={busy === `${focused}:${row.position}`}
            onConfirm={() => void confirmSet(row)}
          />
        ))}
      </ol>
```

Leave everything else in the file alone — the `valueFor`, `draftKey` and `confirmSet` definitions stay exactly where they are.

- [ ] **Step 5: Run the existing tests to verify nothing changed**

Run: `npx vitest run src/ui/session/ActiveSessionScreen.test.tsx`
Expected: PASS, 26 tests — the same number as Step 1, with the test file unmodified.

If any test fails, a rendered string or an `aria-label` drifted during the lift. Fix the component to match the original markup; do not edit the test.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/ui/session/PlannedSetRow.tsx src/ui/session/LoggedSetList.tsx src/ui/session/ActiveSessionScreen.tsx
git commit -m "refactor: extract PlannedSetRow and LoggedSetList"
```

---

### Task 6: The useRestTimer hook

**Files:**
- Create: `src/ui/session/useRestTimer.ts`
- Test: `src/ui/session/useRestTimer.test.ts`

**Interfaces:**
- Consumes: `restTimerView`, `toneAction`, `shouldHoldWakeLock`, `isStaleRestTimer`, `RestTimerRecord`, `RestTimerView` (Task 1); `readRestTimer`, `writeRestTimer`, `clearRestTimer` (Task 2); `playRestTone` (Task 3); `useWakeLock` (Task 4).
- Produces:
  - `interface RestTimer { view: RestTimerView | null; start(restSeconds: number): void; clear(): void }`
  - `useRestTimer(sessionId: string | null, soundEnabled: boolean): RestTimer`

`sessionId` is nullable because the screen calls this hook **before** its early returns — see Task 7.

- [ ] **Step 1: Write the failing tests**

Create `src/ui/session/useRestTimer.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react';
import { STALE_OVERRUN_SECONDS, type RestTimerRecord } from '../../domain/restTimer';
import { REST_TIMER_KEY, readRestTimer, writeRestTimer } from './restTimerStore';
import { playRestTone } from './restTone';
import { useRestTimer } from './useRestTimer';

vi.mock('./restTone', () => ({
  unlockRestTone: vi.fn(),
  playRestTone: vi.fn(),
  resetRestToneForTests: vi.fn(),
}));

const T0 = 1_700_000_000_000;

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
  // defineProperty on document survives the test that set it, so a hidden
  // document would leak into every test that ran after it.
  setHidden(false);
});

/** Drive the display tick forward without leaving React's batching. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'visibilityState', {
    value: hidden ? 'hidden' : 'visible',
    configurable: true,
  });
}

it('has no timer until one is started', () => {
  const { result } = renderHook(() => useRestTimer('s1', true));
  expect(result.current.view).toBeNull();
});

it('starts a countdown and persists it', () => {
  const { result } = renderHook(() => useRestTimer('s1', true));

  act(() => result.current.start(90));

  expect(result.current.view).toEqual({ phase: 'counting', remainingSeconds: 90 });
  expect(readRestTimer('s1')).toMatchObject({ sessionId: 's1', restSeconds: 90, firedAt: null });
});

it('counts down as the clock advances', async () => {
  const { result } = renderHook(() => useRestTimer('s1', true));
  act(() => result.current.start(90));

  await advance(30_000);

  expect(result.current.view).toEqual({ phase: 'counting', remainingSeconds: 60 });
});

it('adopts a rest that was running before the page reloaded', () => {
  // The reason the record is in localStorage at all: an installed iOS PWA
  // often cold-reloads on resume rather than merely suspending.
  const running: RestTimerRecord = {
    sessionId: 's1',
    endsAt: T0 + 45_000,
    restSeconds: 90,
    firedAt: null,
  };
  writeRestTimer(running);

  const { result } = renderHook(() => useRestTimer('s1', true));

  expect(result.current.view).toEqual({ phase: 'counting', remainingSeconds: 45 });
});

it('discards a rest abandoned long enough to be nonsense', () => {
  writeRestTimer({
    sessionId: 's1',
    endsAt: T0 - (STALE_OVERRUN_SECONDS + 60) * 1000,
    restSeconds: 90,
    firedAt: null,
  });

  const { result } = renderHook(() => useRestTimer('s1', true));

  expect(result.current.view).toBeNull();
  expect(localStorage.getItem(REST_TIMER_KEY)).toBeNull();
});

it('holds no timer when there is no session', () => {
  writeRestTimer({ sessionId: 's1', endsAt: T0 + 45_000, restSeconds: 90, firedAt: null });
  const { result } = renderHook(() => useRestTimer(null, true));
  expect(result.current.view).toBeNull();
});

it('clears the timer and the stored record', () => {
  const { result } = renderHook(() => useRestTimer('s1', true));
  act(() => result.current.start(90));

  act(() => result.current.clear());

  expect(result.current.view).toBeNull();
  expect(localStorage.getItem(REST_TIMER_KEY)).toBeNull();
});

it('restarts rather than stacking when a second set is logged mid-rest', () => {
  const { result } = renderHook(() => useRestTimer('s1', true));
  act(() => result.current.start(90));

  act(() => {
    vi.setSystemTime(T0 + 30_000);
    result.current.start(120);
  });

  expect(result.current.view).toEqual({ phase: 'counting', remainingSeconds: 120 });
});

it('plays the tone when rest ends with the app in front', async () => {
  setHidden(false);
  const { result } = renderHook(() => useRestTimer('s1', true));
  act(() => result.current.start(90));

  await advance(91_000);

  expect(playRestTone).toHaveBeenCalledTimes(1);
  expect(result.current.view).toEqual({ phase: 'elapsed', overrunSeconds: 1 });
});

it('plays the tone only once', async () => {
  setHidden(false);
  const { result } = renderHook(() => useRestTimer('s1', true));
  act(() => result.current.start(90));

  await advance(95_000);

  expect(playRestTone).toHaveBeenCalledTimes(1);
});

it('stays silent when the alert sound is switched off, but still marks it fired', async () => {
  // Muting is applied at the speaker, never in the state machine, so a
  // silenced timer and an audible one advance identically.
  setHidden(false);
  const { result } = renderHook(() => useRestTimer('s1', false));
  act(() => result.current.start(90));

  await advance(91_000);

  expect(playRestTone).not.toHaveBeenCalled();
  expect(readRestTimer('s1')?.firedAt).not.toBeNull();
});

it('does not beep late when rest ended while the app was away', async () => {
  const { result } = renderHook(() => useRestTimer('s1', true));
  setHidden(false);
  act(() => result.current.start(90));

  setHidden(true);
  await advance(300_000);
  setHidden(false);
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });

  expect(playRestTone).not.toHaveBeenCalled();
  expect(result.current.view).toEqual({ phase: 'elapsed', overrunSeconds: 210 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ui/session/useRestTimer.test.ts`
Expected: FAIL — cannot resolve `./useRestTimer`.

- [ ] **Step 3: Write the implementation**

Create `src/ui/session/useRestTimer.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isStaleRestTimer,
  restTimerView,
  shouldHoldWakeLock,
  toneAction,
  type RestTimerRecord,
  type RestTimerView,
} from '../../domain/restTimer';
import { clearRestTimer, readRestTimer, writeRestTimer } from './restTimerStore';
import { playRestTone } from './restTone';
import { useWakeLock } from '../useWakeLock';

/**
 * How often the banner redraws. 500 ms rather than 1000: a one-second tick
 * drifts against a one-second display and can sit on the same digit for
 * nearly two seconds.
 */
const TICK_MS = 500;

export interface RestTimer {
  view: RestTimerView | null;
  start(restSeconds: number): void;
  clear(): void;
}

/**
 * The rest timer, wired to storage, the tone and the wake lock.
 *
 * `sessionId` is nullable because ActiveSessionScreen calls this before its
 * early returns — hooks must run in the same order on every render, and that
 * screen returns early for both the loading and the no-session states.
 *
 * Every rule lives in src/domain/restTimer.ts. This hook only decides when to
 * ask.
 */
export function useRestTimer(sessionId: string | null, soundEnabled: boolean): RestTimer {
  const [record, setRecord] = useState<RestTimerRecord | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');

  // Through a ref because the tone fires from inside an interval and a
  // listener: reading the prop directly would rebuild both every time
  // settings changed, restarting the tick.
  const soundRef = useRef(soundEnabled);
  soundRef.current = soundEnabled;

  useEffect(() => {
    if (sessionId === null) {
      setRecord(null);
      return;
    }
    const stored = readRestTimer(sessionId);
    if (stored === null) {
      setRecord(null);
      return;
    }
    // A rest abandoned long enough that m:ss would render nonsense is not a
    // rest any more.
    if (isStaleRestTimer(stored, Date.now())) {
      clearRestTimer();
      setRecord(null);
      return;
    }
    setRecord(stored);
    setNow(Date.now());
  }, [sessionId]);

  const fire = useCallback(
    (current: RestTimerRecord, at: number, trigger: 'tick' | 'became-visible', seen: boolean) => {
      const action = toneAction(current, at, trigger, seen);
      if (action === 'none') return;
      // Muting happens here, at the speaker. The record is marked fired
      // either way, so the setting cannot change the state machine.
      if (action === 'play' && soundRef.current) playRestTone();
      const fired = { ...current, firedAt: at };
      writeRestTimer(fired);
      setRecord(fired);
    },
    [],
  );

  useEffect(() => {
    if (record === null) return;
    const id = setInterval(() => {
      const at = Date.now();
      setNow(at);
      fire(record, at, 'tick', document.visibilityState === 'visible');
    }, TICK_MS);
    return () => clearInterval(id);
  }, [record, fire]);

  useEffect(() => {
    function onVisibilityChange() {
      const seen = document.visibilityState === 'visible';
      const at = Date.now();
      setVisible(seen);
      setNow(at);
      // Coming back to find rest already over marks it fired without a sound.
      // The spike measured that nothing could have played while away, and a
      // beep now would read as "rest just ended" when it did not.
      if (seen && record !== null) fire(record, at, 'became-visible', true);
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [record, fire]);

  useWakeLock(shouldHoldWakeLock(record, now, visible));

  const start = useCallback(
    (restSeconds: number) => {
      if (sessionId === null) return;
      const at = Date.now();
      // Overwrites any running rest: logging another set mid-rest restarts
      // rest, which is what the user just did physically.
      const next: RestTimerRecord = {
        sessionId,
        endsAt: at + restSeconds * 1000,
        restSeconds,
        firedAt: null,
      };
      writeRestTimer(next);
      setRecord(next);
      setNow(at);
    },
    [sessionId],
  );

  const clear = useCallback(() => {
    clearRestTimer();
    setRecord(null);
  }, []);

  return { view: record === null ? null : restTimerView(record, now), start, clear };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/ui/session/useRestTimer.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/session/useRestTimer.ts src/ui/session/useRestTimer.test.ts
git commit -m "feat: add the rest timer hook"
```

---

### Task 7: The banner and the session-screen wiring

**Files:**
- Create: `src/ui/session/RestBanner.tsx`
- Test: `src/ui/session/RestBanner.test.tsx`
- Modify: `src/ui/session/ActiveSessionScreen.tsx`
- Modify: `src/ui/session/ActiveSessionScreen.test.tsx`

**Interfaces:**
- Consumes: `useRestTimer` (Task 6), `unlockRestTone` (Task 3), `RestTimerView` and `formatDuration`.
- Produces: `RestBanner({ view, onSkip })`.

- [ ] **Step 1: Write the failing banner tests**

Create `src/ui/session/RestBanner.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RestBanner } from './RestBanner';

it('shows the time left while rest is running', () => {
  render(<RestBanner view={{ phase: 'counting', remainingSeconds: 84 }} onSkip={() => {}} />);
  expect(screen.getByText(/rest 1:24/i)).toBeInTheDocument();
});

it('says how long ago rest ended, rather than showing a bare zero', () => {
  // Returning after rest has elapsed is the normal flow on iOS, not an edge
  // case, so 0:00 would hide the thing the user most needs to know.
  render(<RestBanner view={{ phase: 'elapsed', overrunSeconds: 184 }} onSkip={() => {}} />);
  expect(screen.getByText(/rest done/i)).toBeInTheDocument();
  expect(screen.getByText(/3:04 over/i)).toBeInTheDocument();
});

it('offers to skip a running rest', async () => {
  const user = userEvent.setup();
  const onSkip = vi.fn();
  render(<RestBanner view={{ phase: 'counting', remainingSeconds: 84 }} onSkip={onSkip} />);

  await user.click(screen.getByRole('button', { name: /skip rest/i }));

  expect(onSkip).toHaveBeenCalledTimes(1);
});

it('offers to dismiss one that is already over', async () => {
  // "Skip" is a lie for something finished.
  const user = userEvent.setup();
  const onSkip = vi.fn();
  render(<RestBanner view={{ phase: 'elapsed', overrunSeconds: 12 }} onSkip={onSkip} />);

  await user.click(screen.getByRole('button', { name: /dismiss/i }));

  expect(onSkip).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/ui/session/RestBanner.test.tsx`
Expected: FAIL — cannot resolve `./RestBanner`.

- [ ] **Step 3: Write the banner**

Create `src/ui/session/RestBanner.tsx`:

```tsx
import { formatDuration } from '../../domain/measurement';
import type { RestTimerView } from '../../domain/restTimer';

interface RestBannerProps {
  view: RestTimerView;
  onSkip: () => void;
}

/**
 * The live countdown. Session-global, not per-exercise: rest keeps running
 * when the user switches focus.
 *
 * Two explicit branches rather than one with ternaries, so the discriminated
 * union narrows without relying on an aliased condition.
 *
 * Deliberately not a live region. The text changes twice a second, so
 * role="status" would flood a screen reader rather than inform it.
 */
export function RestBanner({ view, onSkip }: RestBannerProps) {
  if (view.phase === 'counting') {
    return (
      <p className="rest-timer">
        Rest {formatDuration(view.remainingSeconds)}
        <button type="button" onClick={onSkip}>
          Skip rest
        </button>
      </p>
    );
  }
  return (
    <p className="rest-timer">
      Rest done — {formatDuration(view.overrunSeconds)} over
      <button type="button" onClick={onSkip}>
        Dismiss
      </button>
    </p>
  );
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/ui/session/RestBanner.test.tsx`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing integration tests**

In `src/ui/session/ActiveSessionScreen.test.tsx`, extend the existing `beforeEach` so a record cannot leak between tests:

```ts
beforeEach(async () => {
  await resetDbForTests();
  // The rest timer lives in localStorage, which jsdom keeps between tests.
  localStorage.clear();
});
```

Then append these four tests to the end of the file:

```tsx
it('starts rest when a set is confirmed', async () => {
  const user = userEvent.setup();
  const { routine } = await benchRoutine('Push A', 2);
  await startSession(routine);

  renderScreen();

  await user.type(await screen.findByLabelText(/weight for set 1/i), '135');
  await user.type(screen.getByLabelText(/reps for set 1/i), '8');
  await user.click(screen.getByRole('button', { name: /log set 1/i }));

  // Asserted through the banner's own control rather than its text: the
  // static prescription line already renders a "Rest 1:30" of its own.
  expect(await screen.findByRole('button', { name: /skip rest/i })).toBeInTheDocument();
});

it('does not start rest when the set failed to save', async () => {
  // The timer hangs off the same success flag the drafts do. Starting it
  // regardless would tell the user a set was logged when it was not.
  const user = userEvent.setup();
  const { routine } = await benchRoutine('Push A', 2);
  await startSession(routine);
  vi.mocked(logSet).mockRejectedValueOnce(new Error('quota exceeded'));

  renderScreen();

  await user.type(await screen.findByLabelText(/weight for set 1/i), '135');
  await user.type(screen.getByLabelText(/reps for set 1/i), '8');
  await user.click(screen.getByRole('button', { name: /log set 1/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/quota exceeded/i);
  expect(screen.queryByRole('button', { name: /skip rest/i })).not.toBeInTheDocument();
});

it('takes the banner away when rest is skipped', async () => {
  const user = userEvent.setup();
  const { routine } = await benchRoutine('Push A', 2);
  await startSession(routine);

  renderScreen();

  await user.type(await screen.findByLabelText(/weight for set 1/i), '135');
  await user.type(screen.getByLabelText(/reps for set 1/i), '8');
  await user.click(screen.getByRole('button', { name: /log set 1/i }));
  await user.click(await screen.findByRole('button', { name: /skip rest/i }));

  expect(screen.queryByRole('button', { name: /skip rest/i })).not.toBeInTheDocument();
  expect(localStorage.getItem(REST_TIMER_KEY)).toBeNull();
});

it('clears a running rest when the workout is finished', async () => {
  // Otherwise the record outlives its session and the next workout inherits
  // a countdown from the last one.
  const user = userEvent.setup();
  const { routine } = await benchRoutine('Push A', 1);
  await startSession(routine);

  renderScreen();

  await user.type(await screen.findByLabelText(/weight for set 1/i), '135');
  await user.type(screen.getByLabelText(/reps for set 1/i), '8');
  await user.click(screen.getByRole('button', { name: /log set 1/i }));
  await screen.findByRole('button', { name: /skip rest/i });

  await user.click(screen.getByRole('button', { name: /finish workout/i }));

  expect(await screen.findByText('Today screen')).toBeInTheDocument();
  expect(localStorage.getItem(REST_TIMER_KEY)).toBeNull();
});
```

Add the import the new tests need, beside the existing ones:

```ts
import { REST_TIMER_KEY } from './restTimerStore';
```

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run src/ui/session/ActiveSessionScreen.test.tsx`
Expected: FAIL — the three tests looking for a `skip rest` button fail with "Unable to find an accessible element with the role button and name /skip rest/i", because nothing renders a banner yet. The `does not start rest when the set failed to save` test will pass at this point; that is expected, since it asserts an absence. Confirm it fails later, in Step 9.

- [ ] **Step 7: Wire the timer into `ActiveSessionScreen.tsx`**

Add to the imports:

```tsx
import { RestBanner } from './RestBanner';
import { useRestTimer } from './useRestTimer';
import { unlockRestTone } from './restTone';
```

Immediately after the `const data = useLiveQuery(…)` call and **before** `if (data === undefined)`:

```tsx
  // Called above the early returns because hooks must run in the same order
  // on every render, and this screen returns early for both the loading and
  // the no-session states. Reading through `data?.` is what lets it live
  // here; moving it below the guards breaks on the loading-to-loaded
  // transition.
  const timer = useRestTimer(
    data?.session.id ?? null,
    data?.settings.restAlertSound ?? true,
  );
```

Immediately before the `const sessionControls = (` declaration:

```tsx
  // Declared here and rendered by every return path below, for the same
  // reason sessionControls is: a control present in one branch and absent
  // from another rots, and the branch nobody notices is broken is the one
  // that behaves differently.
  const restBanner = timer.view && <RestBanner view={timer.view} onSkip={timer.clear} />;
```

Render it in **all three** return paths, on the line directly after `{error && <p role="alert">{error}</p>}` — in the empty-routine branch, the unknown-exercise branch, and the main return:

```tsx
        {restBanner}
```

Make `confirmSet`'s first statement the audio unlock:

```tsx
  const confirmSet = async (row: (typeof planned)[number]) => {
    // First, before any await: iOS unlocks audio only inside a user gesture,
    // and after an await this handler is no longer running in one. Getting
    // this wrong produces a timer that is silent on the first rest of every
    // launch and audible forever after.
    unlockRestTone();

    const key = `${focused}:${row.position}`;
```

Inside `confirmSet`'s existing `if (wrote) {` block, after the two state resets:

```tsx
      // Gated on the same flag the drafts are: rest begins when a set was
      // actually performed and stored, never when the write failed.
      timer.start(restSeconds);
```

In `finish()` and `discard()`, clear the timer alongside the navigation, still gated on the existing flag:

```tsx
    if (done) {
      timer.clear();
      navigate('/');
    }
```

- [ ] **Step 8: Run the session screen tests**

Run: `npx vitest run src/ui/session/ActiveSessionScreen.test.tsx`
Expected: PASS, 30 tests (26 existing, unchanged, plus 4 new).

- [ ] **Step 9: Prove the failure-path test can fail**

`does not start rest when the set failed to save` passed before the feature existed, so it has not yet been shown to have teeth. Temporarily move `timer.start(restSeconds)` out of the `if (wrote)` block so it runs unconditionally, then run:

Run: `npx vitest run src/ui/session/ActiveSessionScreen.test.tsx -t "does not start rest"`
Expected: FAIL — a `skip rest` button is found when the test expects none.

Then move `timer.start(restSeconds)` back inside `if (wrote)` and re-run the same command. Expected: PASS.

- [ ] **Step 10: Typecheck and run the whole suite**

Run: `npx tsc --noEmit`
Expected: no output, exit 0.

Run: `npx vitest run --fileParallelism=false`
Expected: PASS — **31 files / 416 tests**. That is the 25 files / 355 tests baseline, plus six new test files carrying 57 tests (18 + 10 + 6 + 7 + 12 + 4), plus the four added to `ActiveSessionScreen.test.tsx`. A run takes about 50 seconds.

If the count is roughly double, a git worktree under `.claude/` is being collected: stop and check the `exclude` in `vite.config.ts` before going further. A doubled pass count reads as good news while hiding a real failure.

- [ ] **Step 11: Commit**

```bash
git add src/ui/session/RestBanner.tsx src/ui/session/RestBanner.test.tsx src/ui/session/ActiveSessionScreen.tsx src/ui/session/ActiveSessionScreen.test.tsx
git commit -m "feat: start a rest countdown when a set is logged"
```

---

## After the plan

**Manual checks on the phone, which no unit test can cover.** Vitest forces `base` to `/`, so a regression in either passes CI and only breaks the deploy.

1. Cold-load `https://zabdi20.github.io/workout-tracker/session` directly. It must reach the app and redirect to Today, not GitHub's 404 page. *(Outstanding from Plan 3.)*
2. Start a session, log a set, background Safari for a few minutes, reopen. The logged set survives and the remaining planned rows resume. *(Outstanding from Plan 3, and load-bearing for this plan.)*
3. **New:** log a set, watch the countdown run to zero with the app in front. The screen must stay awake for the whole rest, and the tone must sound at zero.
4. **New:** log a set, lock the phone, come back after rest would have ended. The banner must read `Rest done — m:ss over`, and **no tone may play**.

## Deliberately not in this plan

- The `shortcuts://run-shortcut` scheme for native background alerts — untested, optional if it ever ships.
- ±30 s adjustment of a running timer.
- A mute control and the Settings screen — Plan 6, with backup. `restAlertSound` is read here and never written.
- Web Push, the `playback` audio category, pre-rendered audio. All three were measured and rejected by the spike.
- `runThenNavigate(fn)`. This plan adds no new instance of the `let done = false` idiom, and folding `finish` and `discard` into a helper while also changing what they do would hide the change inside the refactor.
- CSS.
