/**
 * When to remind the user to back up, and words for how long ago one was made.
 *
 * Pure: no I/O, and the clock comes in as `now`. The count is whole days of
 * elapsed time, not calendar days: a backup made at 11pm is still "today" at
 * 10pm the next night. A backup dated ahead of `now` (a restored file from a
 * phone whose clock runs fast) also reads "today", never a negative count.
 */
const DAY = 86_400_000;

/**
 * Whether Today should remind the user to back up.
 *
 * The reminder needs something to lose: a completed workout that started
 * after the last backup, or any completed workout if there has never been
 * one. With nothing new it stays quiet however old the backup is. Given that,
 * it fires once the backup is MORE than 14 days old, so exactly 14 days is
 * quiet and 14 days and 1 ms is not. With no backup to measure from, the
 * clock starts at the earliest workout the user has not backed up.
 *
 * `completedStarts` may be in any order, so the anchor is the minimum, not
 * the first.
 */
export function backupReminder(
  lastBackupAt: number | undefined,
  completedStarts: number[],
  now: number,
): { kind: 'none' } | { kind: 'never' } | { kind: 'stale'; days: number } {
  const pending =
    lastBackupAt === undefined
      ? completedStarts
      : completedStarts.filter((startedAt) => startedAt > lastBackupAt);
  if (pending.length === 0) return { kind: 'none' };

  const anchor = lastBackupAt ?? Math.min(...pending);
  if (now - anchor <= 14 * DAY) return { kind: 'none' };

  if (lastBackupAt === undefined) return { kind: 'never' };
  return { kind: 'stale', days: Math.floor((now - lastBackupAt) / DAY) };
}

export function daysAgoLabel(then: number, now: number): string {
  const days = Math.max(0, Math.floor((now - then) / DAY));
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}
