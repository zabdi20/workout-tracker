import { daysAgoLabel } from './backupReminder';
import { DAY, NOW } from './backupTestRows';

it.each([
  [0, 'today'],
  [DAY - 1, 'today'],
  [DAY, '1 day ago'],
  [2 * DAY - 1, '1 day ago'],
  [15 * DAY, '15 days ago'],
])('labels %d ms ago as %s', (elapsed, label) => {
  expect(daysAgoLabel(NOW - elapsed, NOW)).toBe(label);
});
