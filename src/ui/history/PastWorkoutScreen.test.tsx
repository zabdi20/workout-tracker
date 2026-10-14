import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { resetDbForTests } from '../../db/db';
import { archiveExercise, updateExercise } from '../../db/exercises';
import { addForgottenSet, listSetsForSession, updateSet } from '../../db/sets';
import { DAY, MIN, T, seedExercise, seedWorkout } from '../../testFixtures';
import { PastWorkoutScreen } from './PastWorkoutScreen';

// Only updateSet and addForgottenSet are overridden, and only for the tests
// that need one call to reject. vi.fn(actual.x) calls through by default, so
// every other call -- including the screen's own reads -- hits the real, reset
// IndexedDB and is indistinguishable from the unmocked function.
vi.mock('../../db/sets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db/sets')>();
  return {
    ...actual,
    updateSet: vi.fn(actual.updateSet),
    addForgottenSet: vi.fn(actual.addForgottenSet),
  };
});

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

async function benchWorkout() {
  const bench = await seedExercise();
  const w = await seedWorkout({
    startedAt: T,
    sets: [
      { exerciseId: bench.id, weight: 225, reps: 5, completedAt: T + MIN },
      { exerciseId: bench.id, weight: 235, reps: 5, completedAt: T + 2 * MIN },
    ],
  });
  return { bench, w };
}

it('fixes a set\'s numbers and warm-up flag', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Edit Barbell Bench Press set 1' }));
  const form = screen.getByRole('form', { name: 'Edit Barbell Bench Press set 1' });
  await user.clear(within(form).getByLabelText(/reps/i));
  await user.type(within(form).getByLabelText(/reps/i), '6');
  await user.click(within(form).getByLabelText('Warm-up'));
  await user.click(within(form).getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('1. 225 lb × 6 (warm-up)', { exact: false })).toBeInTheDocument();
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
});

it('leaves a field unchanged when it is cleared', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Edit Barbell Bench Press set 1' }));
  const form = screen.getByRole('form', { name: 'Edit Barbell Bench Press set 1' });
  await user.clear(within(form).getByLabelText(/reps/i));
  await user.click(within(form).getByRole('button', { name: 'Save' }));
  // The old text is on screen before the save too, so asserting it would pass
  // vacuously. The form closes only once run() resolved true — the write has
  // landed — so read the stored set after that.
  await waitFor(() => expect(screen.queryByRole('form')).not.toBeInTheDocument());
  const [first] = await listSetsForSession(w.id);
  expect(first.reps).toBe(5);
  expect(first.weight).toBe(225);
});

it('keeps what was typed when saving a set fails', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  vi.mocked(updateSet).mockRejectedValueOnce(new Error('quota exceeded'));
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Edit Barbell Bench Press set 1' }));
  const form = screen.getByRole('form', { name: 'Edit Barbell Bench Press set 1' });
  await user.clear(within(form).getByLabelText(/reps/i));
  await user.type(within(form).getByLabelText(/reps/i), '9');
  await user.click(within(form).getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/quota exceeded/i);
  expect(within(form).getByLabelText(/reps/i)).toHaveValue(9);
});

it('deletes a set', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Delete Barbell Bench Press set 1' }));
  expect(await screen.findByText('1. 235 lb × 5', { exact: false })).toBeInTheDocument();
  expect(screen.queryByText(/225 lb/)).not.toBeInTheDocument();
});

it('removes an exercise from the workout when its last set is deleted', async () => {
  const user = userEvent.setup();
  const bench = await seedExercise();
  const squat = await seedExercise('Back Squat');
  const w = await seedWorkout({
    startedAt: T,
    sets: [
      { exerciseId: bench.id, weight: 225, reps: 5, completedAt: T + MIN },
      { exerciseId: squat.id, weight: 315, reps: 5, completedAt: T + 2 * MIN },
    ],
  });
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Delete Back Squat set 1' }));
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Back Squat' })).not.toBeInTheDocument());
});

it('adds a forgotten set after that exercise\'s last set, prefilled from it', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Add set to Barbell Bench Press' }));
  const form = screen.getByRole('form', { name: 'Add a set to Barbell Bench Press' });
  expect(within(form).getByLabelText(/weight/i)).toHaveValue(235);
  await user.clear(within(form).getByLabelText(/reps/i));
  await user.type(within(form).getByLabelText(/reps/i), '3');
  await user.click(within(form).getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('3. 235 lb × 3', { exact: false })).toBeInTheDocument();
});

it('keeps a forgotten set\'s values when saving it fails', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  vi.mocked(addForgottenSet).mockRejectedValueOnce(new Error('quota exceeded'));
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Add set to Barbell Bench Press' }));
  const form = screen.getByRole('form', { name: 'Add a set to Barbell Bench Press' });
  await user.clear(within(form).getByLabelText(/reps/i));
  await user.type(within(form).getByLabelText(/reps/i), '2');
  await user.click(within(form).getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/quota exceeded/i);
  expect(within(form).getByLabelText(/reps/i)).toHaveValue(2);
});

it('re-evaluates later badges when an earlier set is edited', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout(); // set 2 (235 × 5) is the heaviest PR
  renderAt(`/history/${w.id}`);
  expect(await screen.findByText('PR: heaviest, est. 1RM')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Edit Barbell Bench Press set 1' }));
  const form = screen.getByRole('form', { name: 'Edit Barbell Bench Press set 1' });
  await user.clear(within(form).getByLabelText(/weight/i));
  await user.type(within(form).getByLabelText(/weight/i), '245');
  await user.click(within(form).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByText(/PR:/)).not.toBeInTheDocument());
});

it('keeps the PR badge apart from the set it badges', async () => {
  const { w } = await benchWorkout();
  renderAt(`/history/${w.id}`);
  const badge = await screen.findByText('PR: heaviest, est. 1RM');
  // Nothing styles this screen, so a missing space renders "× 5PR: heaviest".
  expect(badge.closest('li')).toHaveTextContent('2. 235 lb × 5 PR: heaviest, est. 1RM');
});

it('writes nothing and stays open when no field of an edit parses', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  vi.mocked(updateSet).mockClear();
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Edit Barbell Bench Press set 1' }));
  const form = screen.getByRole('form', { name: 'Edit Barbell Bench Press set 1' });
  await user.clear(within(form).getByLabelText(/weight/i));
  await user.clear(within(form).getByLabelText(/reps/i));
  await user.click(within(form).getByRole('button', { name: 'Save' }));
  expect(updateSet).not.toHaveBeenCalled();
  expect(screen.getByRole('form', { name: 'Edit Barbell Bench Press set 1' })).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('writes nothing and stays open when no field of a forgotten set parses', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  vi.mocked(addForgottenSet).mockClear();
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Add set to Barbell Bench Press' }));
  const form = screen.getByRole('form', { name: 'Add a set to Barbell Bench Press' });
  await user.clear(within(form).getByLabelText(/weight/i));
  await user.clear(within(form).getByLabelText(/reps/i));
  await user.click(within(form).getByRole('button', { name: 'Save' }));
  expect(addForgottenSet).not.toHaveBeenCalled();
  expect(screen.getByRole('form', { name: 'Add a set to Barbell Bench Press' })).toBeInTheDocument();
  expect(await listSetsForSession(w.id)).toHaveLength(2);
});

it('saves a fractional weight', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Edit Barbell Bench Press set 1' }));
  const form = screen.getByRole('form', { name: 'Edit Barbell Bench Press set 1' });
  // jsdom never refuses a submit over a number input's step, but a browser
  // does: with the default step of 1, Save would silently do nothing for
  // 227.5. The attribute is what stops it, so it is asserted directly.
  expect(form).toHaveProperty('noValidate', true);
  await user.clear(within(form).getByLabelText(/weight/i));
  await user.type(within(form).getByLabelText(/weight/i), '227.5');
  await user.click(within(form).getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('1. 227.5 lb × 5', { exact: false })).toBeInTheDocument();
});

it('keeps the unit a set was logged in, whether fixing it or adding to it', async () => {
  const user = userEvent.setup();
  const bench = await seedExercise();
  const w = await seedWorkout({
    startedAt: T,
    sets: [{ exerciseId: bench.id, weight: 100, reps: 5, unit: 'kg', completedAt: T + MIN }],
  });
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Edit Barbell Bench Press set 1' }));
  let form = screen.getByRole('form', { name: 'Edit Barbell Bench Press set 1' });
  await user.clear(within(form).getByLabelText(/reps/i));
  await user.type(within(form).getByLabelText(/reps/i), '6');
  await user.click(within(form).getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('1. 100 kg × 6', { exact: false })).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Add set to Barbell Bench Press' }));
  form = screen.getByRole('form', { name: 'Add a set to Barbell Bench Press' });
  await user.click(within(form).getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('2. 100 kg × 6', { exact: false })).toBeInTheDocument();
});

it('adds only one forgotten set when Save is tapped twice', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  const actual = await vi.importActual<typeof import('../../db/sets')>('../../db/sets');
  // Held open until after the double tap, so the second tap lands while the
  // first write is still in flight.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  vi.mocked(addForgottenSet).mockImplementationOnce(async (input) => {
    await gate;
    return actual.addForgottenSet(input);
  });
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Add set to Barbell Bench Press' }));
  const form = screen.getByRole('form', { name: 'Add a set to Barbell Bench Press' });
  await user.dblClick(within(form).getByRole('button', { name: 'Save' }));
  release();
  await waitFor(() => expect(screen.queryByRole('form')).not.toBeInTheDocument());
  expect(await listSetsForSession(w.id)).toHaveLength(3);
});

it('closes an edit on Cancel without writing, and reopens it with the stored values', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  vi.mocked(updateSet).mockClear();
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Edit Barbell Bench Press set 1' }));
  let form = screen.getByRole('form', { name: 'Edit Barbell Bench Press set 1' });
  await user.clear(within(form).getByLabelText(/reps/i));
  await user.type(within(form).getByLabelText(/reps/i), '9');
  await user.click(within(form).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('form')).not.toBeInTheDocument();
  expect(updateSet).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: 'Edit Barbell Bench Press set 1' }));
  form = screen.getByRole('form', { name: 'Edit Barbell Bench Press set 1' });
  expect(within(form).getByLabelText(/reps/i)).toHaveValue(5);
});
