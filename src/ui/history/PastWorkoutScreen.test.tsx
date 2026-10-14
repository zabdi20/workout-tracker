import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { resetDbForTests } from '../../db/db';
import { archiveExercise, updateExercise } from '../../db/exercises';
import { DAY, MIN, T, seedExercise, seedWorkout } from '../../testFixtures';
import { PastWorkoutScreen } from './PastWorkoutScreen';

beforeEach(async () => {
  await resetDbForTests();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/history/:sessionId" element={<PastWorkoutScreen />} />
        <Route path="/history" element={<p>History list</p>} />
        <Route path="/session" element={<p>Active session</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

it('shows the workout, its exercises in the order trained, and their sets', async () => {
  // Every plausible wrong ordering disagrees with the right one here:
  // alphabetical, exercise creation order, seed-array order, and first
  // appearance in listSetsForSession's (order, completedAt) sort. The bench's
  // only set has order 1, as it would after its first set was deleted.
  const squat = await seedExercise('Back Squat');
  const bench = await seedExercise('Barbell Bench Press');
  const w = await seedWorkout({
    startedAt: T,
    sets: [
      { exerciseId: squat.id, weight: 315, reps: 5, completedAt: T + 10 * MIN },
      { exerciseId: squat.id, weight: 315, reps: 4, setType: 'warmup', completedAt: T + 11 * MIN },
      { exerciseId: bench.id, weight: 185, reps: 8, order: 1, completedAt: T + MIN },
    ],
  });
  renderAt(`/history/${w.id}`);
  expect(await screen.findByRole('heading', { level: 2, name: 'Push A' })).toBeInTheDocument();
  expect(screen.getByText(new Date(T).toLocaleString(), { exact: false })).toBeInTheDocument();
  expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent))
    .toEqual(['Barbell Bench Press', 'Back Squat']);
  expect(screen.getByText('1. 315 lb × 5')).toBeInTheDocument();
  expect(screen.getByText('2. 315 lb × 4 (warm-up)', { exact: false })).toBeInTheDocument();
});

it('badges a set that beat every earlier workout', async () => {
  const bench = await seedExercise();
  await seedWorkout({ startedAt: T - DAY, sets: [{ exerciseId: bench.id, weight: 225, reps: 5, completedAt: T - DAY + MIN }] });
  const w = await seedWorkout({ startedAt: T, sets: [{ exerciseId: bench.id, weight: 235, reps: 5, completedAt: T + MIN }] });
  renderAt(`/history/${w.id}`);
  expect(await screen.findByText('PR: heaviest, est. 1RM')).toBeInTheDocument();
});

it('judges PRs against the full history, not just this workout', async () => {
  const bench = await seedExercise();
  await seedWorkout({ startedAt: T - DAY, sets: [{ exerciseId: bench.id, weight: 245, reps: 5, completedAt: T - DAY + MIN }] });
  const w = await seedWorkout({
    startedAt: T,
    sets: [
      { exerciseId: bench.id, weight: 225, reps: 5, completedAt: T + MIN },
      { exerciseId: bench.id, weight: 235, reps: 5, completedAt: T + 2 * MIN },
    ],
  });
  renderAt(`/history/${w.id}`);
  await screen.findByText('2. 235 lb × 5', { exact: false });
  expect(screen.queryByText(/PR:/)).not.toBeInTheDocument();
});

it('says so when the workout is not found', async () => {
  renderAt('/history/nope');
  expect(await screen.findByRole('alert')).toHaveTextContent(/workout not found/i);
  expect(screen.getByRole('link', { name: /history/i })).toHaveAttribute('href', '/history');
});

it('sends the workout in progress to the active session', async () => {
  const w = await seedWorkout({ startedAt: T, status: 'in_progress', endedAt: null });
  renderAt(`/history/${w.id}`);
  expect(await screen.findByText('Active session')).toBeInTheDocument();
});

it('still shows a workout whose exercise was archived later, marked archived', async () => {
  const bench = await seedExercise();
  const w = await seedWorkout({ startedAt: T, sets: [{ exerciseId: bench.id, weight: 225, reps: 5, completedAt: T + MIN }] });
  await archiveExercise(bench.id);
  renderAt(`/history/${w.id}`);
  expect(await screen.findByRole('heading', { level: 3, name: 'Barbell Bench Press (archived)' })).toBeInTheDocument();
});

it('drops badges for an exercise retyped away from weight × reps', async () => {
  const bench = await seedExercise();
  await seedWorkout({ startedAt: T - DAY, sets: [{ exerciseId: bench.id, weight: 225, reps: 5, completedAt: T - DAY + MIN }] });
  const w = await seedWorkout({ startedAt: T, sets: [{ exerciseId: bench.id, weight: 235, reps: 5, completedAt: T + MIN }] });
  await updateExercise(bench.id, { measurementType: 'bodyweight_reps' });
  renderAt(`/history/${w.id}`);
  await screen.findByRole('heading', { level: 3 });
  expect(screen.queryByText(/PR:/)).not.toBeInTheDocument();
});

it('shows a workout whose sets were all deleted', async () => {
  const w = await seedWorkout({ startedAt: T, sets: [] });
  renderAt(`/history/${w.id}`);
  expect(await screen.findByText('No sets were logged.')).toBeInTheDocument();
});
