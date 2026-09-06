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
