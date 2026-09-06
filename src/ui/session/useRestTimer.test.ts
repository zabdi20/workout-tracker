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
  expect(readRestTimer('s1')?.firedAt).toEqual(expect.any(Number));
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

it('does not beep late when the deadline already passed on a cold reload', async () => {
  // The primary iOS path: an installed PWA cold-reloads on resume rather
  // than merely suspending, so there is no visibilitychange event to run
  // the became-visible suppression — the document loads already visible.
  // A record adopted this way must be treated identically to one that
  // survived the background, or the tick effect's first tick plays the
  // tone up to STALE_OVERRUN_SECONDS late.
  writeRestTimer({
    sessionId: 's1',
    endsAt: T0 - 60_000,
    restSeconds: 90,
    firedAt: null,
  });

  const { result } = renderHook(() => useRestTimer('s1', true));
  // The interval's first tick (500 ms, the hook's TICK_MS) is exactly what
  // would play the tone late if the load effect had not already marked the
  // record fired.
  await advance(500);

  expect(playRestTone).not.toHaveBeenCalled();
  expect(result.current.view).toEqual({ phase: 'elapsed', overrunSeconds: 60 });
  expect(readRestTimer('s1')?.firedAt).toEqual(expect.any(Number));
});

it('re-checks staleness on resume, not only at load', async () => {
  // The other half of the iOS resume coin: a page that survives the whole
  // background stretch never re-runs the load effect, so a record that
  // went stale while hidden would otherwise sit forever as
  // "Rest done — 743:12 over" and keep the 500 ms tick re-rendering the
  // screen. staleness must be re-evaluated on visibilitychange too.
  const { result } = renderHook(() => useRestTimer('s1', true));
  setHidden(false);
  act(() => result.current.start(90));

  setHidden(true);
  // 90 s to reach endsAt, then past STALE_OVERRUN_SECONDS of overrun.
  await advance((90 + STALE_OVERRUN_SECONDS + 60) * 1000);
  setHidden(false);
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });

  expect(result.current.view).toBeNull();
  expect(localStorage.getItem(REST_TIMER_KEY)).toBeNull();
});
