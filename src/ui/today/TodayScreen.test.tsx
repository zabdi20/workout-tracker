import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { resetDbForTests } from '../../db/db';
import { createCustomExercise } from '../../db/exercises';
import { createRoutine, setRoutineItems } from '../../db/routines';
import { getOrCreateActiveCycle, saveCycle } from '../../db/cycles';
import { getInProgressSession, startSession } from '../../db/sessions';
import { TodayScreen } from './TodayScreen';

beforeEach(async () => {
  await resetDbForTests();
});

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<TodayScreen />} />
        <Route path="/session" element={<p>Session screen</p>} />
        <Route path="/cycle" element={<p>Cycle editor</p>} />
      </Routes>
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

it('shows an alert instead of a permanent loading state when bootstrap fails', async () => {
  const cycles = await import('../../db/cycles');
  const spy = vi.spyOn(cycles, 'getOrCreateActiveCycle')
    .mockRejectedValueOnce(new Error('disk on fire'));

  renderScreen();

  expect(await screen.findByRole('alert')).toHaveTextContent(/disk on fire/i);
  spy.mockRestore();
});

it('says the routine is empty rather than showing nothing', async () => {
  const r = await createRoutine('Push Day');
  const c = await getOrCreateActiveCycle();
  await saveCycle({ ...c, routineIds: [r.id], currentIndex: 0 });

  renderScreen();
  expect(await screen.findByText(/no exercises in this routine/i)).toBeInTheDocument();
});

it('starts a session for the routine that is up next', async () => {
  const user = userEvent.setup();
  const routine = await createRoutine('Push Day');
  // Start is gated on the routine having exercises (see the "no exercises"
  // test below) — an empty routine here would hide the very button this
  // test clicks.
  await setRoutineItems(routine.id, [{ id: 'i1', exerciseId: 'bench', order: 0 }]);
  const cycle = await getOrCreateActiveCycle();
  await saveCycle({ ...cycle, routineIds: [routine.id], currentIndex: 0 });

  renderScreen();

  await user.click(await screen.findByRole('button', { name: /start push day/i }));

  expect(await screen.findByText('Session screen')).toBeInTheDocument();
  expect((await getInProgressSession())?.routineId).toBe(routine.id);
});

it('offers Resume instead of Start while a session is open', async () => {
  const routine = await createRoutine('Push Day');
  const cycle = await getOrCreateActiveCycle();
  await saveCycle({ ...cycle, routineIds: [routine.id], currentIndex: 0 });
  await startSession(routine);

  renderScreen();

  expect(await screen.findByRole('link', { name: /resume push day/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /start push day/i })).toBeNull();
});

it('starts a routine other than the one up next', async () => {
  const user = userEvent.setup();
  const push = await createRoutine('Push Day');
  const legs = await createRoutine('Leg Day');
  // The picker filters out routines with nothing to log, same gate as the
  // primary Start button, so Leg Day needs at least one item to be pickable.
  await setRoutineItems(legs.id, [{ id: 'i1', exerciseId: 'squat', order: 0 }]);
  const cycle = await getOrCreateActiveCycle();
  await saveCycle({ ...cycle, routineIds: [push.id, legs.id], currentIndex: 0 });

  renderScreen();

  await user.click(await screen.findByRole('button', { name: /do a different one/i }));
  await user.click(await screen.findByRole('button', { name: /^leg day$/i }));

  expect(await screen.findByText('Session screen')).toBeInTheDocument();
  expect((await getInProgressSession())?.routineId).toBe(legs.id);
});

it('does not offer Start when the routine has no exercises to log', async () => {
  const routine = await createRoutine('Push Day');
  const cycle = await getOrCreateActiveCycle();
  await saveCycle({ ...cycle, routineIds: [routine.id], currentIndex: 0 });

  renderScreen();

  await screen.findByText(/no exercises in this routine/i);
  expect(screen.queryByRole('button', { name: /start push day/i })).toBeNull();
});

it('surfaces a refusal to start rather than failing silently', async () => {
  const user = userEvent.setup();
  const push = await createRoutine('Push Day');
  const legs = await createRoutine('Leg Day');
  const cycle = await getOrCreateActiveCycle();
  await saveCycle({ ...cycle, routineIds: [push.id, legs.id], currentIndex: 0 });
  await setRoutineItems(legs.id, [{ id: 'i1', exerciseId: 'squat', order: 0 }]);
  await startSession(push);

  renderScreen();

  // Resume is showing, so reaching startSession for another routine means
  // the picker was opened first. Open it and try.
  await user.click(await screen.findByRole('button', { name: /do a different one/i }));
  await user.click(await screen.findByRole('button', { name: /^leg day$/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/already in progress/i);
});
