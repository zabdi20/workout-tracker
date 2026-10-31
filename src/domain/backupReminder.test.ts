import { backupReminder, daysAgoLabel } from './backupReminder';
import { DAY, HOUR, NOW } from './backupTestRows';

it.each([
  [0, 'today'],
  [DAY - 1, 'today'],
  [DAY, '1 day ago'],
  [2 * DAY - 1, '1 day ago'],
  [15 * DAY, '15 days ago'],
  // A backup dated ahead of the clock (a restored file from a phone running
  // fast): never a negative count.
  [-1, 'today'],
  [-23 * HOUR, 'today'],
])('labels %d ms since the backup as %s', (elapsed, label) => {
  expect(daysAgoLabel(NOW - elapsed, NOW)).toBe(label);
});

const B = NOW - 20 * DAY;
it.each<[string, number | undefined, number[], ReturnType<typeof backupReminder>]>([
  // Rejects: reminding whenever there has never been a backup.
  ['nothing logged, never backed up', undefined, [], { kind: 'none' }],
  // Rejects: `>=` where the rule says `>`.
  ['first workout exactly 14 days ago', undefined, [NOW - 14 * DAY], { kind: 'none' }],
  // Rejects: a threshold above 14 days.
  ['first workout 14 days and 1 ms ago', undefined, [NOW - 14 * DAY - 1], { kind: 'never' }],
  // Rejects: reminding with nothing new to back up (no `pending` check).
  ['nothing since a stale backup', B, [B - DAY], { kind: 'none' }],
  // Rejects: counting a workout that started at the backup instant as new (`>=`).
  ['a workout starting at the instant of a stale backup', B, [B], { kind: 'none' }],
  ['a workout since a stale backup', B, [B + DAY], { kind: 'stale', days: 20 }],
  // Rejects: `>=` where the rule says `>`.
  ['a backup exactly 14 days old', NOW - 14 * DAY, [NOW - DAY], { kind: 'none' }],
  ['a backup 14 days and 1 ms old', NOW - 14 * DAY - 1, [NOW - DAY], { kind: 'stale', days: 14 }],
  // Starts listed newest first, so Math.min, not [0], must pick the anchor.
  ['never backed up, oldest of several', undefined, [NOW - DAY, NOW - 15 * DAY, NOW - 3 * DAY], { kind: 'never' }],
])('%s', (_label, last, starts, expected) => {
  expect(backupReminder(last, starts, NOW)).toEqual(expected);
});
