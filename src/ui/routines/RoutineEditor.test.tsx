import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { resetDbForTests } from '../../db/db';
import { createCustomExercise } from '../../db/exercises';
import { createRoutine, getRoutine, setRoutineItems } from '../../db/routines';
import { RoutineEditor } from './RoutineEditor';

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
