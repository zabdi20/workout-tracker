/**
 * Words for how long ago a backup was made.
 *
 * Pure: no I/O, and the clock comes in as `now`. The count is whole days of
 * elapsed time, not calendar days: a backup made at 11pm is still "today" at
 * 10pm the next night. A backup dated ahead of `now` (a restored file from a
 * phone whose clock runs fast) also reads "today", never a negative count.
 */
const DAY = 86_400_000;

export function daysAgoLabel(then: number, now: number): string {
  const days = Math.max(0, Math.floor((now - then) / DAY));
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}
