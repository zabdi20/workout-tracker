import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { resetDbForTests } from '../../db/db';
import { createCustomExercise, archiveExercise } from '../../db/exercises';
import {
  createRoutine, getRoutine, setRoutineItems, updateRoutineItems,
} from '../../db/routines';
import { RoutineEditor } from './RoutineEditor';

// Only updateRoutineItems is overridden, and only for the one test that
// needs it to reject — vi.fn(actual.updateRoutineItems) calls through by
// default, so mockRejectedValueOnce affects exactly one call and every
// other invocation (including the editor's own move/remove writes) is
// indistinguishable from the unmocked function against the real, reset
// IndexedDB. Same seam as ActiveSessionScreen.test.tsx uses over logSet.
vi.mock('../../db/routines', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db/routines')>();
  return { ...actual, updateRoutineItems: vi.fn(actual.updateRoutineItems) };
});

beforeEach(async () => {
  await resetDbForTests();
});

function renderAt(routineId: string) {
  return render(
    <MemoryRouter initialEntries={[`/routines/${routineId}`]}>
      <Routes>
        <Route path="/routines/:routineId" element={<RoutineEditor />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function seedExercise(name: string) {
  return createCustomExercise({
    name,
    primaryMuscles: ['chest'],
    secondaryMuscles: [],
    equipment: 'barbell',
    measurementType: 'weight_reps',
  });
}

it('shows the routine name', async () => {
  const r = await createRoutine('Push Day');
  renderAt(r.id);
  expect(await screen.findByDisplayValue('Push Day')).toBeInTheDocument();
});

it('reports a missing routine rather than rendering an empty editor', async () => {
  renderAt('does-not-exist');
  expect(await screen.findByRole('alert')).toHaveTextContent(/not found/i);
});

it('renames the routine', async () => {
  const user = userEvent.setup();
  const r = await createRoutine('Push Day');
  renderAt(r.id);

  const field = await screen.findByLabelText(/routine name/i);
  await user.clear(field);
  await user.type(field, 'Heavy Push');
  await user.click(screen.getByRole('button', { name: /save name/i }));

  await expect.poll(async () => (await getRoutine(r.id))?.name).toBe('Heavy Push');
});

it('adds an exercise from the browser', async () => {
  const user = userEvent.setup();
  const ex = await seedExercise('Barbell Bench Press');
  const r = await createRoutine('Push Day');
  renderAt(r.id);

  await user.click(await screen.findByRole('button', { name: /add exercise/i }));
  await user.click(await screen.findByRole('button', { name: /barbell bench press/i }));

  await expect.poll(async () => (await getRoutine(r.id))?.items.length).toBe(1);
  expect((await getRoutine(r.id))?.items[0].exerciseId).toBe(ex.id);
});

it('lists the routine exercises in order', async () => {
  const a = await seedExercise('Bench Press');
  const b = await seedExercise('Cable Fly');
  const r = await createRoutine('Push Day');
  await setRoutineItems(r.id, [
    { id: 'i1', exerciseId: a.id, order: 0 },
    { id: 'i2', exerciseId: b.id, order: 1 },
  ]);

  renderAt(r.id);

  const listed = await screen.findAllByTestId('routine-item-name');
  expect(listed.map((el) => el.textContent)).toEqual(['Bench Press', 'Cable Fly']);
});

it('moves an exercise up', async () => {
  const user = userEvent.setup();
  const a = await seedExercise('Bench Press');
  const b = await seedExercise('Cable Fly');
  const r = await createRoutine('Push Day');
  await setRoutineItems(r.id, [
    { id: 'i1', exerciseId: a.id, order: 0 },
    { id: 'i2', exerciseId: b.id, order: 1 },
  ]);

  renderAt(r.id);
  await screen.findAllByTestId('routine-item-name');
  await user.click(screen.getByRole('button', { name: /move cable fly up/i }));

  await expect.poll(async () => {
    const items = (await getRoutine(r.id))?.items ?? [];
    return items.map((i) => i.exerciseId);
  }).toEqual([b.id, a.id]);
});

it('removes an exercise', async () => {
  const user = userEvent.setup();
  const a = await seedExercise('Bench Press');
  const r = await createRoutine('Push Day');
  await setRoutineItems(r.id, [{ id: 'i1', exerciseId: a.id, order: 0 }]);

  renderAt(r.id);
  await screen.findAllByTestId('routine-item-name');
  await user.click(screen.getByRole('button', { name: /remove bench press/i }));

  await expect.poll(async () => (await getRoutine(r.id))?.items.length).toBe(0);
});

it('tells the user when the routine has no exercises', async () => {
  const r = await createRoutine('Push Day');
  renderAt(r.id);
  expect(await screen.findByText(/no exercises yet/i)).toBeInTheDocument();
});

it('saves a prescription when the field loses focus', async () => {
  const user = userEvent.setup();
  const ex = await seedExercise('Barbell Bench Press');
  const routine = await createRoutine('Push A');
  await setRoutineItems(routine.id, [{ id: 'i1', exerciseId: ex.id, order: 0 }]);

  renderAt(routine.id);

  const sets = await screen.findByLabelText(/sets for barbell bench press/i);
  await user.type(sets, '4');
  await user.tab();

  await waitFor(async () => {
    expect((await getRoutine(routine.id))?.items[0].targetSets).toBe(4);
  });
});

it('shows the stored prescription when the editor opens', async () => {
  const ex = await seedExercise('Barbell Bench Press');
  const routine = await createRoutine('Push A');
  await setRoutineItems(routine.id, [
    { id: 'i1', exerciseId: ex.id, order: 0, targetSets: 4, targetRepMin: 6, targetRepMax: 8 },
  ]);

  renderAt(routine.id);

  expect(await screen.findByLabelText(/^sets for barbell bench press/i)).toHaveValue(4);
  expect(screen.getByLabelText(/lowest reps for barbell bench press/i)).toHaveValue(6);
  expect(screen.getByLabelText(/highest reps for barbell bench press/i)).toHaveValue(8);
});

it('refuses a backwards rep range and does not write it', async () => {
  const user = userEvent.setup();
  const ex = await seedExercise('Barbell Bench Press');
  const routine = await createRoutine('Push A');
  await setRoutineItems(routine.id, [
    { id: 'i1', exerciseId: ex.id, order: 0, targetRepMax: 6 },
  ]);

  renderAt(routine.id);

  const min = await screen.findByLabelText(/lowest reps for barbell bench press/i);
  await user.type(min, '8');
  await user.tab();

  expect(await screen.findByRole('alert')).toHaveTextContent(/rep range/i);
  expect((await getRoutine(routine.id))?.items[0].targetRepMin).toBeUndefined();
});

it('clears a prescription field when it is emptied', async () => {
  const user = userEvent.setup();
  const ex = await seedExercise('Barbell Bench Press');
  const routine = await createRoutine('Push A');
  await setRoutineItems(routine.id, [
    { id: 'i1', exerciseId: ex.id, order: 0, targetSets: 4 },
  ]);

  renderAt(routine.id);

  const sets = await screen.findByLabelText(/^sets for barbell bench press/i);
  await user.clear(sets);
  await user.tab();

  await waitFor(async () => {
    expect((await getRoutine(routine.id))?.items[0].targetSets).toBeUndefined();
  });
});

it('keeps the typed prescription when the write fails, so the user can retry it', async () => {
  // The same defect already fixed in ActiveSessionScreen.confirmSet: run()
  // swallows the rejection to surface it as an alert instead of throwing, so
  // clearing the draft around the await wipes the number the user just typed
  // and snaps the field back to the stored one — at the exact moment they
  // need to retry rather than retype.
  const user = userEvent.setup();
  const ex = await seedExercise('Barbell Bench Press');
  const routine = await createRoutine('Push A');
  await setRoutineItems(routine.id, [{ id: 'i1', exerciseId: ex.id, order: 0 }]);
  vi.mocked(updateRoutineItems).mockRejectedValueOnce(new Error('quota exceeded'));

  renderAt(routine.id);

  const sets = await screen.findByLabelText(/^sets for barbell bench press/i);
  await user.type(sets, '4');
  await user.tab();

  expect(await screen.findByRole('alert')).toHaveTextContent(/quota exceeded/i);
  expect(sets).toHaveValue(4);
  expect((await getRoutine(routine.id))?.items[0].targetSets).toBeUndefined();
});

it('marks an archived exercise so it is not mistaken for an active one', async () => {
  const ex = await seedExercise('Barbell Bench Press');
  await archiveExercise(ex.id);
  const routine = await createRoutine('Push A');
  await setRoutineItems(routine.id, [{ id: 'i1', exerciseId: ex.id, order: 0 }]);

  renderAt(routine.id);

  expect(await screen.findByText(/archived/i)).toBeInTheDocument();
});
