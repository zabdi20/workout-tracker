import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { resetDbForTests } from '../../db/db';
import { createCustomExercise } from '../../db/exercises';
import { createRoutine, setRoutineItems } from '../../db/routines';
import { startSession } from '../../db/sessions';
import { listSetsForSession, logSet } from '../../db/sets';
import { ActiveSessionScreen } from './ActiveSessionScreen';

beforeEach(async () => {
  await resetDbForTests();
});

function renderScreen() {
  return render(
    <MemoryRouter initialEntries={['/session']}>
      <Routes>
        <Route path="/session" element={<ActiveSessionScreen />} />
        <Route path="/" element={<p>Today screen</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function benchRoutine(name = 'Push A', targetSets?: number) {
  const exercise = await createCustomExercise({
    name: 'Barbell Bench Press',
    primaryMuscles: ['chest'],
    secondaryMuscles: [],
    equipment: 'barbell',
    measurementType: 'weight_reps',
  });
  const routine = await createRoutine(name);
  const items = [{ id: 'i1', exerciseId: exercise.id, order: 0, targetSets }];
  await setRoutineItems(routine.id, items);
  return { exercise, routine, items };
}

it('redirects to Today when no session is in progress', async () => {
  renderScreen();
  expect(await screen.findByText('Today screen')).toBeInTheDocument();
});

it('never creates a session of its own', async () => {
  const { db } = await import('../../db/db');
  renderScreen();
  await screen.findByText('Today screen');
  expect(await db.sessions.count()).toBe(0);
});

it('lists the routine’s exercises and focuses the first', async () => {
  const { routine, items } = await benchRoutine();
  const squat = await createCustomExercise({
    name: 'Back Squat',
    primaryMuscles: ['quads'],
    secondaryMuscles: [],
    equipment: 'barbell',
    measurementType: 'weight_reps',
  });
  await setRoutineItems(routine.id, [
    ...items,
    { id: 'i2', exerciseId: squat.id, order: 1 },
  ]);
  await startSession(routine);

  renderScreen();

  expect(await screen.findByRole('button', { name: /back squat/i })).toBeInTheDocument();
  expect(
    await screen.findByRole('heading', { level: 3, name: /barbell bench press/i }),
  ).toBeInTheDocument();
});

it('switches focus when another exercise is tapped', async () => {
  const user = userEvent.setup();
  const { routine, items } = await benchRoutine();
  const squat = await createCustomExercise({
    name: 'Back Squat',
    primaryMuscles: ['quads'],
    secondaryMuscles: [],
    equipment: 'barbell',
    measurementType: 'weight_reps',
  });
  await setRoutineItems(routine.id, [
    ...items,
    { id: 'i2', exerciseId: squat.id, order: 1 },
  ]);
  await startSession(routine);

  renderScreen();
  await user.click(await screen.findByRole('button', { name: /back squat/i }));

  expect(
    await screen.findByRole('heading', { level: 3, name: /back squat/i }),
  ).toBeInTheDocument();
});

it('shows the prescription beside the exercise', async () => {
  const { routine, items } = await benchRoutine('Push A', 4);
  await setRoutineItems(routine.id, [
    { ...items[0], targetSets: 4, targetRepMin: 6, targetRepMax: 8, restSeconds: 120 },
  ]);
  await startSession(routine);

  renderScreen();

  expect(await screen.findByText(/4 × 6–8/)).toBeInTheDocument();
  expect(screen.getByText(/rest 2:00/i)).toBeInTheDocument();
});

it('marks an archived exercise but still allows logging against it', async () => {
  const { exercise, routine } = await benchRoutine();
  const { archiveExercise } = await import('../../db/exercises');
  await archiveExercise(exercise.id);
  await startSession(routine);

  renderScreen();

  expect(await screen.findByText(/archived/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /log set 1/i })).toBeEnabled();
});
