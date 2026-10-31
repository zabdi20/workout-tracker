import { daysAgoLabel } from './backupReminder';
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
