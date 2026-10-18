import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { resetDbForTests } from '../../db/db';
import { archiveExercise } from '../../db/exercises';
import { DAY, MIN, T, seedExercise, seedWorkout } from '../../testFixtures';
import { RecordsScreen } from './RecordsScreen';

beforeEach(async () => {
  await resetDbForTests();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/exercises/:exerciseId/records" element={<RecordsScreen />} />
      </Routes>
    </MemoryRouter>,
  );
}

it('shows the heaviest set, the best estimate and the rep bests', async () => {
  // The heavier rep best is logged LAST, so heaviest-first is neither
  // chronological nor alphabetical.
  const bench = await seedExercise();
  await seedWorkout({ startedAt: T, sets: [
    { exerciseId: bench.id, weight: 225, reps: 5, completedAt: T + MIN },
    { exerciseId: bench.id, weight: 225, reps: 6, completedAt: T + 2 * MIN },
    { exerciseId: bench.id, weight: 235, reps: 3, completedAt: T + 3 * MIN },
  ] });
  renderAt(`/exercises/${bench.id}/records`);
  expect(await screen.findByRole('heading', { level: 2, name: 'Barbell Bench Press — records' })).toBeInTheDocument();
  expect(await screen.findByText('Heaviest: 235 lb × 3', { exact: false })).toBeInTheDocument();
  expect(screen.getByText('Best est. 1RM: 270.0 lb, from 225 lb × 6', { exact: false })).toBeInTheDocument();
  expect(within(screen.getByRole('list', { name: 'Rep bests' })).getAllByRole('listitem').map((li) => li.textContent?.split(' · ')[0]))
    .toEqual(['235 lb × 3', '225 lb × 6']);
});

it('lists different units as separate rep bests, ordered by real weight', async () => {
  // 100 kg and 100 lb stay separate rows. Kilogram order (100 kg, 60 kg,
  // 100 lb) differs from raw-number order, alphabetical order and
  // chronological order, so only a real conversion produces it.
  const bench = await seedExercise();
  await seedWorkout({ startedAt: T, sets: [
    { exerciseId: bench.id, unit: 'lb', weight: 100, reps: 8, completedAt: T + MIN },
    { exerciseId: bench.id, unit: 'kg', weight: 60, reps: 5, completedAt: T + 2 * MIN },
    { exerciseId: bench.id, unit: 'kg', weight: 100, reps: 3, completedAt: T + 3 * MIN },
  ] });
  renderAt(`/exercises/${bench.id}/records`);
  const rows = within(await screen.findByRole('list', { name: 'Rep bests' })).getAllByRole('listitem');
  expect(rows.map((li) => li.textContent?.split(' · ')[0])).toEqual(['100 kg × 3', '60 kg × 5', '100 lb × 8']);
});

it('shows the estimate in the unit of the set it came from, rounded to one decimal', async () => {
  // Every other fixture is in pounds. 100 kg × 5 estimates 116.666…, which
  // rounds to 116.7 and would truncate to 116.6, so only toFixed(1) and the
  // set's own unit produce this line.
  const bench = await seedExercise();
  await seedWorkout({ startedAt: T, sets: [
    { exerciseId: bench.id, unit: 'kg', weight: 100, reps: 5, completedAt: T + MIN },
  ] });
  renderAt(`/exercises/${bench.id}/records`);
  expect(await screen.findByText('Best est. 1RM: 116.7 kg, from 100 kg × 5', { exact: false })).toBeInTheDocument();
});

it('says records are kept for weight-and-reps exercises only', async () => {
  const plank = await seedExercise('Plank', 'duration');
  renderAt(`/exercises/${plank.id}/records`);
  expect(await screen.findByText('Records are kept for weight-and-reps exercises only.')).toBeInTheDocument();
});

it('says so when nothing has been logged', async () => {
  const bench = await seedExercise();
  renderAt(`/exercises/${bench.id}/records`);
  expect(await screen.findByText('No working sets logged yet.')).toBeInTheDocument();
});

it('says so when the exercise is not found', async () => {
  renderAt('/exercises/nope/records');
  expect(await screen.findByRole('alert')).toHaveTextContent('Exercise not found.');
});

it('ends each record with the date of the set that holds it', async () => {
  // The heaviest ties, so the earlier set holds it; the estimate and the rep
  // best belong to the later set. Different days tell the two dates apart.
  const bench = await seedExercise();
  await seedWorkout({ startedAt: T, sets: [
    { exerciseId: bench.id, weight: 225, reps: 5, completedAt: T + MIN },
  ] });
  await seedWorkout({ startedAt: T + DAY, sets: [
    { exerciseId: bench.id, weight: 225, reps: 6, completedAt: T + DAY + MIN },
  ] });
  const first = new Date(T + MIN).toLocaleDateString();
  const second = new Date(T + DAY + MIN).toLocaleDateString();
  renderAt(`/exercises/${bench.id}/records`);
  expect(await screen.findByText(`Heaviest: 225 lb × 5 · ${first}`)).toBeInTheDocument();
  expect(screen.getByText(`Best est. 1RM: 270.0 lb, from 225 lb × 6 · ${second}`)).toBeInTheDocument();
  expect(within(screen.getByRole('list', { name: 'Rep bests' })).getAllByRole('listitem').map((li) => li.textContent))
    .toEqual([`225 lb × 6 · ${second}`]);
});

it('leaves out the estimate when every set is above its rep limit', async () => {
  const bench = await seedExercise();
  await seedWorkout({ startedAt: T, sets: [
    { exerciseId: bench.id, weight: 100, reps: 15, completedAt: T + MIN },
  ] });
  renderAt(`/exercises/${bench.id}/records`);
  expect(await screen.findByText('Heaviest: 100 lb × 15', { exact: false })).toBeInTheDocument();
  expect(screen.queryByText('Best est. 1RM', { exact: false })).not.toBeInTheDocument();
});

it('keeps the records of an exercise that was archived afterwards', async () => {
  // Archiving hides an exercise from pickers; it does not erase what was
  // lifted. The page is still reachable from a past workout's heading.
  const bench = await seedExercise();
  await seedWorkout({ startedAt: T, sets: [
    { exerciseId: bench.id, weight: 225, reps: 5, completedAt: T + MIN },
    { exerciseId: bench.id, weight: 235, reps: 3, completedAt: T + 2 * MIN },
  ] });
  await archiveExercise(bench.id);
  renderAt(`/exercises/${bench.id}/records`);
  expect(await screen.findByRole('heading', { level: 2, name: 'Barbell Bench Press — records' })).toBeInTheDocument();
  expect(screen.getByText('Heaviest: 235 lb × 3', { exact: false })).toBeInTheDocument();
  expect(within(screen.getByRole('list', { name: 'Rep bests' })).getAllByRole('listitem').map((li) => li.textContent?.split(' · ')[0]))
    .toEqual(['235 lb × 3', '225 lb × 5']);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
