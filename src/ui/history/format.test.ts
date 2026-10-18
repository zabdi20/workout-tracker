import { formatWorkoutDuration, fromDateTimeLocalValue, toDateTimeLocalValue } from './format';

it('shows whole minutes', () => expect(formatWorkoutDuration(0, 75 * 60_000 + 20_000)).toBe('75 min'));
it('shows a dash when the workout has no end', () => expect(formatWorkoutDuration(0, undefined)).toBe('—'));

it('formats a timestamp for a datetime-local input, in local time', () => {
  expect(toDateTimeLocalValue(new Date(2025, 0, 6, 7, 5).getTime())).toBe('2025-01-06T07:05');
});
it('parses a datetime-local value back, in local time', () => {
  expect(fromDateTimeLocalValue('2025-01-06T07:05')).toBe(new Date(2025, 0, 6, 7, 5).getTime());
});
it('gives NaN for an empty value', () => expect(fromDateTimeLocalValue('')).toBeNaN());
it('gives NaN for a value that is not a datetime-local string', () => {
  expect(fromDateTimeLocalValue('2025-01-06')).toBeNaN();
  expect(fromDateTimeLocalValue('1')).toBeNaN();
  expect(fromDateTimeLocalValue('tomorrow')).toBeNaN();
});
it('reads a value that carries seconds, which a browser sends when they are not zero', () => {
  expect(fromDateTimeLocalValue('2025-01-06T07:05:30')).toBe(new Date(2025, 0, 6, 7, 5, 30).getTime());
});
it('round-trips through both helpers at minute precision', () => {
  const ms = new Date(2024, 11, 30, 18, 30).getTime();
  expect(fromDateTimeLocalValue(toDateTimeLocalValue(ms))).toBe(ms);
});
