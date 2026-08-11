import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { resetDbForTests } from '../../db/db';
import { createCustomExercise } from '../../db/exercises';
import { createRoutine, setRoutineItems } from '../../db/routines';
import { getOrCreateActiveCycle, saveCycle } from '../../db/cycles';
import { TodayScreen } from './TodayScreen';

beforeEach(async () => {
  await resetDbForTests();
});

function renderScreen() {
  return render(
    <MemoryRouter>
      <TodayScreen />
    </MemoryRouter>,
  );
}

it('prompts to build a rotation when none exists', async () => {
  renderScreen();
  expect(await screen.findByText(/nothing in your rotation/i)).toBeInTheDocument();
});

it('names the next routine', async () => {
  const r = await createRoutine('Push Day');
  const c = await getOrCreateActiveCycle();
  await saveCycle({ ...c, routineIds: [r.id], currentIndex: 0 });

  renderScreen();
  expect(await screen.findByText('Push Day')).toBeInTheDocument();
});

it('shows the position in the rotation', async () => {
  const a = await createRoutine('Push Day');
  const b = await createRoutine('Pull Day');
  const c = await getOrCreateActiveCycle();
  await saveCycle({ ...c, routineIds: [a.id, b.id], currentIndex: 1 });

  renderScreen();
  expect(await screen.findByText(/2 of 2/i)).toBeInTheDocument();
});

it('lists the exercises of the next routine', async () => {
  const ex = await createCustomExercise({
    name: 'Barbell Bench Press',
    primaryMuscles: ['chest'],
    secondaryMuscles: [],
    equipment: 'barbell',
    measurementType: 'weight_reps',
  });
  const r = await createRoutine('Push Day');
  await setRoutineItems(r.id, [{ id: 'i1', exerciseId: ex.id, order: 0 }]);
  const c = await getOrCreateActiveCycle();
  await saveCycle({ ...c, routineIds: [r.id], currentIndex: 0 });

  renderScreen();
  expect(await screen.findByText('Barbell Bench Press')).toBeInTheDocument();
});

it('skips to the next routine', async () => {
  const user = userEvent.setup();
  const a = await createRoutine('Push Day');
  const b = await createRoutine('Pull Day');
  const c = await getOrCreateActiveCycle();
  await saveCycle({ ...c, routineIds: [a.id, b.id], currentIndex: 0 });

  renderScreen();
  await screen.findByText('Push Day');
  await user.click(screen.getByRole('button', { name: /skip/i }));

  expect(await screen.findByText('Pull Day')).toBeInTheDocument();
  await expect.poll(async () => (await getOrCreateActiveCycle()).currentIndex).toBe(1);
});

it('says the routine is empty rather than showing nothing', async () => {
  const r = await createRoutine('Push Day');
  const c = await getOrCreateActiveCycle();
  await saveCycle({ ...c, routineIds: [r.id], currentIndex: 0 });

  renderScreen();
  expect(await screen.findByText(/no exercises in this routine/i)).toBeInTheDocument();
});
