import { formatWorkoutDuration } from './format';

it('shows whole minutes', () => expect(formatWorkoutDuration(0, 75 * 60_000 + 20_000)).toBe('75 min'));
it('shows a dash when the workout has no end', () => expect(formatWorkoutDuration(0, undefined)).toBe('—'));
