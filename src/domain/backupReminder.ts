/**
 * Words for how long ago a backup was made.
 *
 * Pure: no I/O, and the clock comes in as `now`. The count is whole days of
 * elapsed time, not calendar days: a backup made at 11pm is still "today" at
 * 10pm the next night.
 */
const DAY = 86_400_000;

export function daysAgoLabel(then: number, now: number): string {
  const days = Math.floor((now - then) / DAY);
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}
