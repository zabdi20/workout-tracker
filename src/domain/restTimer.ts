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
  // Add 0 to convert -0 to +0.
  return { phase: 'elapsed', overrunSeconds: Math.floor(-remainingMs / 1000) + 0 };
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
