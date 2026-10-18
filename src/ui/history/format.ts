/** Whole minutes, or a dash for a workout with no recorded end. */
export function formatWorkoutDuration(startedAt: number, endedAt?: number): string {
  if (endedAt === undefined) return '—';
  return `${Math.round((endedAt - startedAt) / 60_000)} min`;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/**
 * A timestamp as a datetime-local input holds it: the viewer's own wall clock,
 * `YYYY-MM-DDTHH:mm`, no zone and no seconds. Not toISOString, which is UTC and
 * would show the workout hours away from when it happened.
 */
export function toDateTimeLocalValue(ms: number): string {
  const d = new Date(ms);
  return (
    `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

// Seconds are optional: the input sends them only when they are not zero.
const DATE_TIME_LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * The inverse of toDateTimeLocalValue, in local time, or NaN for anything that
 * is not one (an empty field, say). Parsed by hand rather than with
 * `new Date(value)`, whose fallback parser reads '1' as the year 2001.
 */
export function fromDateTimeLocalValue(value: string): number {
  const match = DATE_TIME_LOCAL.exec(value);
  if (!match) return NaN;
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number);
  return new Date(year, month - 1, day, hour, minute, Number(match[6] ?? 0)).getTime();
}
