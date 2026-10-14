import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { resetDbForTests } from '../../db/db';
import { DAY, MIN, T, seedExercise, seedWorkout } from '../../testFixtures';
import { HistoryScreen } from './HistoryScreen';

beforeEach(async () => {
  await resetDbForTests();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/history" element={<HistoryScreen />} />
        <Route path="/history/:sessionId" element={<p>Workout detail</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

it('lists finished workouts newest first, without the one in progress', async () => {
  // Names chosen so newest-first is neither alphabetical nor seed order.
  await seedWorkout({ name: 'Aardvark', startedAt: T - 2 * DAY });
  await seedWorkout({ name: 'Zebra', startedAt: T });
  await seedWorkout({ name: 'Live', startedAt: T + DAY, status: 'in_progress', endedAt: null });
  renderAt('/history');
  await screen.findByRole('link', { name: 'Zebra' });
  expect(screen.getAllByRole('link').map((l) => l.textContent)).toEqual(['Zebra', 'Aardvark']);
});

it('shows the date, duration, working-set count and PR count', async () => {
  const bench = await seedExercise();
  await seedWorkout({ name: 'First', startedAt: T - DAY, sets: [{ exerciseId: bench.id, weight: 225, reps: 5, completedAt: T - DAY + MIN }] });
  await seedWorkout({
    name: 'Second', startedAt: T, endedAt: T + 75 * MIN,
    sets: [
      { exerciseId: bench.id, weight: 135, reps: 10, setType: 'warmup', completedAt: T + MIN },
      { exerciseId: bench.id, weight: 235, reps: 5, completedAt: T + 2 * MIN },
      { exerciseId: bench.id, weight: 235, reps: 5, completedAt: T + 3 * MIN },
    ],
  });
  renderAt('/history');
  const row = (await screen.findByRole('link', { name: 'Second' })).closest('li')!;
  expect(row).toHaveTextContent(`${new Date(T).toLocaleString()} · 75 min · 2 sets · 1 PR`);
  const firstRow = screen.getByRole('link', { name: 'First' }).closest('li')!;
  expect(firstRow).not.toHaveTextContent('PR');
  // "1 sets" would pass a plain substring match on "1 set".
  expect(firstRow.textContent).toMatch(/· 1 set(?!s)/);
});

it('shows a dash rather than NaN when a workout has no end time', async () => {
  await seedWorkout({ name: 'Unended', startedAt: T, endedAt: null });
  renderAt('/history');
  const row = (await screen.findByRole('link', { name: 'Unended' })).closest('li')!;
  expect(row).toHaveTextContent('—');
  expect(row).not.toHaveTextContent('NaN');
});

it('says so when nothing has been finished yet', async () => {
  renderAt('/history');
  expect(await screen.findByText('No finished workouts yet.')).toBeInTheDocument();
});

it('opens a workout', async () => {
  const user = userEvent.setup();
  await seedWorkout({ name: 'Push A', startedAt: T });
  renderAt('/history');
  await user.click(await screen.findByRole('link', { name: 'Push A' }));
  expect(await screen.findByText('Workout detail')).toBeInTheDocument();
});
