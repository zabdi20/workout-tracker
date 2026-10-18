import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { resetDbForTests } from '../../db/db';
import { archiveExercise, updateExercise } from '../../db/exercises';
import { deleteCompletedSession, getSession, moveSession } from '../../db/sessions';
import { addForgottenSet, listSetsForSession, updateSet } from '../../db/sets';
import { DAY, MIN, T, seedExercise, seedWorkout } from '../../testFixtures';
import { PastWorkoutScreen } from './PastWorkoutScreen';
import { toDateTimeLocalValue } from './format';

// Only updateSet, addForgottenSet, moveSession and deleteCompletedSession are
// overridden, and only for the tests that need to watch a call or make one
// reject. vi.fn(actual.x) calls through by default, so every other call --
// including the screen's own reads -- hits the real, reset IndexedDB and is
// indistinguishable from the unmocked function.
vi.mock('../../db/sets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db/sets')>();
  return {
    ...actual,
    updateSet: vi.fn(actual.updateSet),
    addForgottenSet: vi.fn(actual.addForgottenSet),
  };
});

vi.mock('../../db/sessions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db/sessions')>();
  return {
    ...actual,
    moveSession: vi.fn(actual.moveSession),
    deleteCompletedSession: vi.fn(actual.deleteCompletedSession),
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
  // The marker sits outside the link, so the link is named for the exercise
  // alone. The heading's name reads the same either way; this tells them apart.
  expect(screen.getByRole('link', { name: 'Barbell Bench Press' }))
    .toHaveAttribute('href', `/exercises/${bench.id}/records`);
});

it('keeps the badges of an exercise that was archived afterwards', async () => {
  // Archived after the record was set. Both the set that earned it and the
  // earlier workout it beat belong to an exercise that is no longer open.
  const bench = await seedExercise();
  await seedWorkout({ startedAt: T - DAY, sets: [{ exerciseId: bench.id, weight: 225, reps: 5, completedAt: T - DAY + MIN }] });
  const w = await seedWorkout({ startedAt: T, sets: [{ exerciseId: bench.id, weight: 235, reps: 5, completedAt: T + MIN }] });
  await archiveExercise(bench.id);
  renderAt(`/history/${w.id}`);
  expect(await screen.findByText('PR: heaviest, est. 1RM')).toBeInTheDocument();
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
  // Re-queried from the live document, not through `form` from before Save:
  // React detaches an unmounted subtree intact, so that node would still hold
  // the typed 9 even if the form had closed on failure.
  expect(
    within(screen.getByRole('form', { name: 'Edit Barbell Bench Press set 1' })).getByLabelText(/reps/i),
  ).toHaveValue(9);
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
  // Re-queried from the live document for the same reason as the edit case
  // above: a detached form would still hold the typed 2.
  expect(
    within(screen.getByRole('form', { name: 'Add a set to Barbell Bench Press' })).getByLabelText(/reps/i),
  ).toHaveValue(2);
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

it('moves the workout to a new date and time', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Change date and time' }));
  const target = new Date(2024, 11, 30, 18, 30).getTime();
  fireEvent.change(screen.getByLabelText('Workout start'), { target: { value: toDateTimeLocalValue(target) } });
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText(new Date(target).toLocaleString(), { exact: false })).toBeInTheDocument();
  expect((await getSession(w.id))?.startedAt).toBe(target);
});

it('refuses a time that would end in the future, keeping the input', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Change date and time' }));
  const value = toDateTimeLocalValue(Date.now() + DAY);
  fireEvent.change(screen.getByLabelText('Workout start'), { target: { value } });
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/future/i);
  expect(screen.getByLabelText('Workout start')).toHaveValue(value);
});

it('asks before deleting the workout, and Keep it changes nothing', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Delete workout' }));
  await user.click(screen.getByRole('button', { name: 'Keep it' }));
  expect(await getSession(w.id)).toBeDefined();
});

it('deletes the workout and returns to the list', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Delete workout' }));
  await user.click(screen.getByRole('button', { name: 'Yes, delete it' }));
  expect(await screen.findByText('History list')).toBeInTheDocument();
  expect(await getSession(w.id)).toBeUndefined();
});

it('opens the start time prefilled with the stored one, in local time', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Change date and time' }));
  expect(screen.getByLabelText('Workout start')).toHaveValue(toDateTimeLocalValue(T));
  expect(screen.getByLabelText('Workout start')).toHaveAttribute('type', 'datetime-local');
});

it('does not let the browser\'s own validation block a time typed without seconds', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Change date and time' }));
  // jsdom does not enforce a datetime-local input's step on submit, but a
  // browser does, and a value that disagrees with the step would leave Save
  // doing nothing. Same attribute, same reason, as the number inputs of a set.
  expect(screen.getByRole('form', { name: 'Change date and time' })).toHaveProperty('noValidate', true);
});

it('keeps the typed time and lets it be corrected after a refused move', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Change date and time' }));
  fireEvent.change(screen.getByLabelText('Workout start'), {
    target: { value: toDateTimeLocalValue(Date.now() + DAY) },
  });
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('alert');

  // A refused Save must leave Save usable, or the user could only Cancel.
  const target = new Date(2024, 11, 30, 18, 30).getTime();
  fireEvent.change(screen.getByLabelText('Workout start'), { target: { value: toDateTimeLocalValue(target) } });
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByLabelText('Workout start')).not.toBeInTheDocument());
  expect((await getSession(w.id))?.startedAt).toBe(target);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('writes nothing and stays open when the time cannot be read', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  vi.mocked(moveSession).mockClear();
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Change date and time' }));
  fireEvent.change(screen.getByLabelText('Workout start'), { target: { value: '' } });
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(moveSession).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Workout start')).toHaveValue('');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect((await getSession(w.id))?.startedAt).toBe(T);
});

it('closes the date form on Cancel without writing, and reopens it with the stored time', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  vi.mocked(moveSession).mockClear();
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Change date and time' }));
  fireEvent.change(screen.getByLabelText('Workout start'), {
    target: { value: toDateTimeLocalValue(new Date(2024, 11, 30, 18, 30).getTime()) },
  });
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByLabelText('Workout start')).not.toBeInTheDocument();
  expect(moveSession).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: 'Change date and time' }));
  expect(screen.getByLabelText('Workout start')).toHaveValue(toDateTimeLocalValue(T));
});

it('moves the workout only once when Save is tapped twice', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  const actual = await vi.importActual<typeof import('../../db/sessions')>('../../db/sessions');
  vi.mocked(moveSession).mockClear();
  // Held open until after the double tap, so the second tap lands while the
  // first write is still in flight.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  vi.mocked(moveSession).mockImplementationOnce(async (id, newStartedAt) => {
    await gate;
    return actual.moveSession(id, newStartedAt);
  });
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Change date and time' }));
  fireEvent.change(screen.getByLabelText('Workout start'), {
    target: { value: toDateTimeLocalValue(new Date(2024, 11, 30, 18, 30).getTime()) },
  });
  await user.dblClick(screen.getByRole('button', { name: 'Save' }));
  release();
  await waitFor(() => expect(screen.queryByLabelText('Workout start')).not.toBeInTheDocument());
  expect(moveSession).toHaveBeenCalledTimes(1);
});

it('puts the confirmation in plain words, and Keep it puts the button back', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  renderAt(`/history/${w.id}`);
  await screen.findByRole('button', { name: 'Delete workout' });
  expect(screen.queryByText('Delete this workout and everything logged in it?')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Delete workout' }));
  expect(screen.getByText('Delete this workout and everything logged in it?')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Delete workout' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Keep it' }));
  expect(screen.queryByText('Delete this workout and everything logged in it?')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Delete workout' })).toBeInTheDocument();
});

it('stays on the workout, says why, and can retry when the delete fails', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  vi.mocked(deleteCompletedSession).mockRejectedValueOnce(new Error('quota exceeded'));
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Delete workout' }));
  await user.click(screen.getByRole('button', { name: 'Yes, delete it' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/quota exceeded/i);
  expect(screen.queryByText('History list')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: 'Push A' })).toBeInTheDocument();
  expect(await getSession(w.id)).toBeDefined();

  // The confirmation is still open and its button still works.
  await user.click(screen.getByRole('button', { name: 'Yes, delete it' }));
  expect(await screen.findByText('History list')).toBeInTheDocument();
  expect(await getSession(w.id)).toBeUndefined();
});

it('deletes the workout\'s sets with it', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Delete workout' }));
  await user.click(screen.getByRole('button', { name: 'Yes, delete it' }));
  await screen.findByText('History list');
  expect(await listSetsForSession(w.id)).toHaveLength(0);
});

it('deletes the workout only once when Yes is tapped twice', async () => {
  const user = userEvent.setup();
  const { w } = await benchWorkout();
  const actual = await vi.importActual<typeof import('../../db/sessions')>('../../db/sessions');
  vi.mocked(deleteCompletedSession).mockClear();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  vi.mocked(deleteCompletedSession).mockImplementationOnce(async (id) => {
    await gate;
    return actual.deleteCompletedSession(id);
  });
  renderAt(`/history/${w.id}`);
  await user.click(await screen.findByRole('button', { name: 'Delete workout' }));
  await user.dblClick(screen.getByRole('button', { name: 'Yes, delete it' }));
  release();
  expect(await screen.findByText('History list')).toBeInTheDocument();
  expect(deleteCompletedSession).toHaveBeenCalledTimes(1);
});

it('links weight-and-reps exercises to their records, and nothing else', async () => {
  const bench = await seedExercise();
  const plank = await seedExercise('Plank', 'duration');
  const w = await seedWorkout({ startedAt: T, sets: [
    { exerciseId: bench.id, weight: 225, reps: 5, completedAt: T + MIN },
    { exerciseId: plank.id, durationSeconds: 60, completedAt: T + 2 * MIN },
  ] });
  renderAt(`/history/${w.id}`);
  expect(await screen.findByRole('link', { name: 'Barbell Bench Press' }))
    .toHaveAttribute('href', `/exercises/${bench.id}/records`);
  expect(screen.queryByRole('link', { name: 'Plank' })).not.toBeInTheDocument();
});
