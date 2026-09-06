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
  const [record, setRecordState] = useState<RestTimerRecord | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');

  // Through a ref because the tone fires from inside an interval and a
  // listener: reading the prop directly would rebuild both every time
  // settings changed, restarting the tick.
  const soundRef = useRef(soundEnabled);
  soundRef.current = soundEnabled;

  // Mirrors `record`, updated synchronously in the same call that updates
  // state. The interval and the visibility listener read this instead of a
  // `record` closed over when the effect last ran: under fake timers (and in
  // principle under real ones too) several 500 ms ticks can fire before React
  // commits the re-render that would give the effect a fresh closure. Without
  // this, every one of those ticks would see the same firedAt: null and the
  // tone would fire once per tick instead of once.
  const recordRef = useRef<RestTimerRecord | null>(null);

  const setRecord = useCallback((next: RestTimerRecord | null) => {
    recordRef.current = next;
    setRecordState(next);
  }, []);

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
  }, [sessionId, setRecord]);

  const fire = useCallback(
    (at: number, trigger: 'tick' | 'became-visible', seen: boolean) => {
      const current = recordRef.current;
      if (current === null) return;
      const action = toneAction(current, at, trigger, seen);
      if (action === 'none') return;
      // Muting happens here, at the speaker. The record is marked fired
      // either way, so the setting cannot change the state machine.
      if (action === 'play' && soundRef.current) playRestTone();
      const fired = { ...current, firedAt: at };
      writeRestTimer(fired);
      setRecord(fired);
    },
    [setRecord],
  );

  useEffect(() => {
    if (record === null) return;
    const id = setInterval(() => {
      const at = Date.now();
      setNow(at);
      fire(at, 'tick', document.visibilityState === 'visible');
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
      if (seen) fire(at, 'became-visible', true);
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [fire]);

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
    [sessionId, setRecord],
  );

  const clear = useCallback(() => {
    clearRestTimer();
    setRecord(null);
  }, [setRecord]);

  return { view: record === null ? null : restTimerView(record, now), start, clear };
}
