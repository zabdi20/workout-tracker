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
