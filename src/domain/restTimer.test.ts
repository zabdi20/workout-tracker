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
