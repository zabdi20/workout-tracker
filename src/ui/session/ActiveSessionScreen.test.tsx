import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { resetDbForTests } from '../../db/db';
import { createCustomExercise } from '../../db/exercises';
import { createRoutine, setRoutineItems } from '../../db/routines';
import { startSession } from '../../db/sessions';
import { listSetsForSession, logSet } from '../../db/sets';
import { ActiveSessionScreen } from './ActiveSessionScreen';

// Only logSet is overridden, and only for the one test that needs it to
// reject — every other test (including the ones that call logSet directly
// to seed a previous session) still hits the real, reset IndexedDB via
// importOriginal. vi.fn(actual.logSet) calls through by default, so
// mockRejectedValueOnce affects exactly one call and every other invocation
// is indistinguishable from the unmocked function.
vi.mock('../../db/sets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db/sets')>();
  return { ...actual, logSet: vi.fn(actual.logSet) };
});

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

it('prefills each row from last time’s matching set', async () => {
  const { exercise, routine } = await benchRoutine('Push A', 3);
  const previous = await startSession(routine);
  await logSet({
    sessionId: previous.id, exerciseId: exercise.id, setType: 'working',
    unit: 'lb', weight: 135, reps: 8,
  });
  await logSet({
    sessionId: previous.id, exerciseId: exercise.id, setType: 'working',
    unit: 'lb', weight: 145, reps: 6,
  });
  await (await import('../../db/sessions')).finishSession(previous.id);
  await startSession(routine);

  renderScreen();

  expect(await screen.findByLabelText(/weight for set 1/i)).toHaveValue(135);
  expect(screen.getByLabelText(/weight for set 2/i)).toHaveValue(145);
  // Row 3 has no matching set, so it falls back to last time's final set.
  expect(screen.getByLabelText(/weight for set 3/i)).toHaveValue(145);
});

it('shows the last-time line', async () => {
  const { exercise, routine } = await benchRoutine();
  const previous = await startSession(routine);
  await logSet({
    sessionId: previous.id, exerciseId: exercise.id, setType: 'working',
    unit: 'lb', weight: 135, reps: 8,
  });
  await (await import('../../db/sessions')).finishSession(previous.id);
  await startSession(routine);

  renderScreen();

  expect(await screen.findByText(/last time: 135 lb × 8/i)).toBeInTheDocument();
});

it('writes a set when the row is confirmed', async () => {
  const user = userEvent.setup();
  const { routine } = await benchRoutine('Push A', 2);
  const session = await startSession(routine);

  renderScreen();

  await user.type(await screen.findByLabelText(/weight for set 1/i), '135');
  await user.type(screen.getByLabelText(/reps for set 1/i), '8');
  await user.click(screen.getByRole('button', { name: /log set 1/i }));

  await waitFor(async () => {
    const stored = await listSetsForSession(session.id);
    expect(stored).toHaveLength(1);
    expect(stored[0].weight).toBe(135);
    expect(stored[0].reps).toBe(8);
    expect(stored[0].setType).toBe('working');
  });
});

it('keeps logged sets and resumes the remaining rows after a remount', async () => {
  // The test that encodes the whole autosave decision. Safari killing the
  // tab must lose nothing that was actually performed, and the unconfirmed
  // rows must re-derive rather than being replayed from anywhere.
  const user = userEvent.setup();
  const { routine } = await benchRoutine('Push A', 3);
  await startSession(routine);

  const first = renderScreen();
  await user.type(await screen.findByLabelText(/weight for set 1/i), '135');
  await user.type(screen.getByLabelText(/reps for set 1/i), '8');
  await user.click(screen.getByRole('button', { name: /log set 1/i }));
  await screen.findByText(/1\. 135 lb × 8/);
  first.unmount();

  renderScreen();

  expect(await screen.findByText(/1\. 135 lb × 8/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /log set 2/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /log set 1/i })).toBeNull();
});

it('flags a warm-up and keeps it out of the working count', async () => {
  const user = userEvent.setup();
  const { routine } = await benchRoutine('Push A', 2);
  const session = await startSession(routine);

  renderScreen();

  await user.type(await screen.findByLabelText(/weight for set 1/i), '45');
  await user.type(screen.getByLabelText(/reps for set 1/i), '10');
  await user.click(screen.getByLabelText(/mark set 1 as a warm-up/i));
  await user.click(screen.getByRole('button', { name: /log set 1/i }));

  await waitFor(async () => {
    expect((await listSetsForSession(session.id))[0].setType).toBe('warmup');
  });
  // A warm-up does not consume a planned row: set 1 is still to do.
  expect(await screen.findByRole('button', { name: /log set 1/i })).toBeInTheDocument();
});

it('adds and removes planned rows mid-workout', async () => {
  const user = userEvent.setup();
  const { routine } = await benchRoutine('Push A', 2);
  await startSession(routine);

  renderScreen();

  await user.click(await screen.findByRole('button', { name: /^add set$/i }));
  expect(await screen.findByRole('button', { name: /log set 3/i })).toBeInTheDocument();

  await user.click(screen.getByLabelText(/remove planned set 3/i));
  expect(screen.queryByRole('button', { name: /log set 3/i })).toBeNull();
});

it('removes a logged set', async () => {
  const user = userEvent.setup();
  const { exercise, routine } = await benchRoutine('Push A', 2);
  const session = await startSession(routine);
  await logSet({
    sessionId: session.id, exerciseId: exercise.id, setType: 'working',
    unit: 'lb', weight: 135, reps: 8,
  });

  renderScreen();

  await user.click(await screen.findByLabelText(/remove logged set 1/i));

  await waitFor(async () => {
    expect(await listSetsForSession(session.id)).toHaveLength(0);
  });
});

it('renders only the fields a duration exercise needs, and writes through them', async () => {
  // confirmSet maps a field spec's `property` onto a LoggedSet through a
  // union-keyed `Record<string, number>` cast. Rendering the field proves
  // nothing about that cast: only confirming the row does. This covers the
  // write, the durationSeconds mapping and formatSet's duration branch.
  const user = userEvent.setup();
  const plank = await createCustomExercise({
    name: 'Plank',
    primaryMuscles: ['abs'],
    secondaryMuscles: [],
    equipment: 'bodyweight',
    measurementType: 'duration',
  });
  const routine = await createRoutine('Core');
  await setRoutineItems(routine.id, [{ id: 'i1', exerciseId: plank.id, order: 0 }]);
  const session = await startSession(routine);

  renderScreen();

  const seconds = await screen.findByLabelText(/seconds for set 1/i);
  expect(screen.queryByLabelText(/weight for set 1/i)).toBeNull();
  expect(screen.queryByLabelText(/reps for set 1/i)).toBeNull();

  await user.type(seconds, '45');
  await user.click(screen.getByRole('button', { name: /log set 1/i }));

  await waitFor(async () => {
    const stored = await listSetsForSession(session.id);
    expect(stored).toHaveLength(1);
    expect(stored[0].durationSeconds).toBe(45);
    expect(stored[0].weight).toBeUndefined();
    expect(stored[0].reps).toBeUndefined();
  });
  expect(await screen.findByText(/1\. 0:45/)).toBeInTheDocument();
});

it('writes both fields of a distance-and-duration set', async () => {
  // The only two-field non-weight type, so it is the one that would catch a
  // field mapping that happened to work for a single-field type by accident.
  const user = userEvent.setup();
  const rower = await createCustomExercise({
    name: 'Rowing Machine',
    primaryMuscles: ['upper_back'],
    secondaryMuscles: [],
    equipment: 'machine',
    measurementType: 'distance_duration',
  });
  const routine = await createRoutine('Conditioning');
  await setRoutineItems(routine.id, [{ id: 'i1', exerciseId: rower.id, order: 0 }]);
  const session = await startSession(routine);

  renderScreen();

  await user.type(await screen.findByLabelText(/metres for set 1/i), '500');
  await user.type(screen.getByLabelText(/seconds for set 1/i), '105');
  await user.click(screen.getByRole('button', { name: /log set 1/i }));

  await waitFor(async () => {
    const stored = await listSetsForSession(session.id);
    expect(stored).toHaveLength(1);
    expect(stored[0].distanceMeters).toBe(500);
    expect(stored[0].durationSeconds).toBe(105);
  });
  expect(await screen.findByText(/1\. 500 m in 1:45/)).toBeInTheDocument();
});

it('has one remove control for the planned list, named for the last row', async () => {
  // adjust is a signed count applied to the total row count, not a
  // position, so it can only ever drop the highest-positioned row. A
  // control per row would always remove the last row no matter which one
  // was tapped — this pins that there is exactly one control, and that its
  // accessible name matches the row it actually removes.
  const user = userEvent.setup();
  const { routine } = await benchRoutine('Push A', 3);
  await startSession(routine);

  renderScreen();
  await screen.findByRole('button', { name: /log set 3/i });

  const removeControls = screen.getAllByLabelText(/remove planned set/i);
  expect(removeControls).toHaveLength(1);
  expect(removeControls[0]).toHaveAccessibleName('Remove planned set 3');

  await user.click(removeControls[0]);

  expect(screen.queryByRole('button', { name: /log set 3/i })).toBeNull();
  expect(screen.getByRole('button', { name: /log set 2/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /log set 1/i })).toBeInTheDocument();
});

it('does not write a set when a blank row is confirmed', async () => {
  // No last performance for this exercise, so the row's inputs start
  // genuinely empty rather than prefilled. Confirming it with nothing
  // typed must not call logSet — that would put a set nobody performed
  // into the sets table, where it would resurface as next session's
  // prefill and silently blank the row it was meant to fill.
  const user = userEvent.setup();
  const { routine } = await benchRoutine('Push A', 2);
  const session = await startSession(routine);

  renderScreen();

  const weightInput = await screen.findByLabelText(/weight for set 1/i);
  expect(weightInput).toHaveValue(null);
  await user.click(screen.getByRole('button', { name: /log set 1/i }));

  expect(await listSetsForSession(session.id)).toHaveLength(0);
  // The row is still there, unconsumed, ready to be filled in for real.
  expect(screen.getByRole('button', { name: /log set 1/i })).toBeEnabled();
  expect(weightInput).toHaveValue(null);
});

it('keeps what was typed when the write fails, so the user can retry it', async () => {
  // A rejected logSet must not cost the user their input. run() swallows
  // the rejection to surface it as an alert instead of throwing, and a
  // quota-exceeded write or an unavailable IndexedDB happens exactly when
  // retyping the set is the last thing someone mid-workout wants to do.
  const user = userEvent.setup();
  const { routine } = await benchRoutine('Push A', 2);
  const session = await startSession(routine);
  vi.mocked(logSet).mockRejectedValueOnce(new Error('quota exceeded'));

  renderScreen();

  const weightInput = await screen.findByLabelText(/weight for set 1/i);
  const repsInput = screen.getByLabelText(/reps for set 1/i);
  await user.type(weightInput, '135');
  await user.type(repsInput, '8');
  await user.click(screen.getByRole('button', { name: /log set 1/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/quota exceeded/i);
  expect(weightInput).toHaveValue(135);
  expect(repsInput).toHaveValue(8);
  // The busy guard still clears on failure: the row must stay retryable,
  // not lock the confirm button because its one attempt failed.
  expect(screen.getByRole('button', { name: /log set 1/i })).toBeEnabled();
  expect(await listSetsForSession(session.id)).toHaveLength(0);
});

it('adds an exercise that is not in the routine', async () => {
  const user = userEvent.setup();
  const { routine } = await benchRoutine('Push A', 1);
  await createCustomExercise({
    name: 'Cable Fly',
    primaryMuscles: ['chest'],
    secondaryMuscles: [],
    equipment: 'cable',
    measurementType: 'weight_reps',
  });
  await startSession(routine);

  renderScreen();

  await user.click(await screen.findByRole('button', { name: /add exercise/i }));
  await user.click(await screen.findByRole('button', { name: /cable fly/i }));

  expect(
    await screen.findByRole('heading', { level: 3, name: /cable fly/i }),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /log set 1/i })).toBeInTheDocument();
});

it('gives an added exercise its history from the last time it was trained', async () => {
  // The deviation path: the squat rack is occupied, so log something else.
  // The exercise is not in today's routine and has no sets in this session,
  // so it only reaches the history read if adding it is what puts it there.
  // Without that the row renders unprefilled and the screen claims there is
  // no history — self-healing after the first set, which is the one set
  // that needed the reference.
  const user = userEvent.setup();
  const { routine } = await benchRoutine('Push A', 1);
  const fly = await createCustomExercise({
    name: 'Cable Fly',
    primaryMuscles: ['chest'],
    secondaryMuscles: [],
    equipment: 'cable',
    measurementType: 'weight_reps',
  });

  const previous = await startSession(routine);
  await logSet({
    sessionId: previous.id, exerciseId: fly.id, setType: 'working',
    unit: 'lb', weight: 30, reps: 12,
  });
  await (await import('../../db/sessions')).finishSession(previous.id);
  await startSession(routine);

  renderScreen();

  await user.click(await screen.findByRole('button', { name: /add exercise/i }));
  await user.click(await screen.findByRole('button', { name: /cable fly/i }));

  expect(await screen.findByText(/last time: 30 lb × 12/i)).toBeInTheDocument();
  expect(screen.queryByText(/no history for this exercise yet/i)).toBeNull();
  expect(screen.getByLabelText(/weight for set 1/i)).toHaveValue(30);
  expect(screen.getByLabelText(/reps for set 1/i)).toHaveValue(12);
});

it('keeps an added exercise after a set is logged into it', async () => {
  const { routine } = await benchRoutine('Push A', 1);
  const fly = await createCustomExercise({
    name: 'Cable Fly',
    primaryMuscles: ['chest'],
    secondaryMuscles: [],
    equipment: 'cable',
    measurementType: 'weight_reps',
  });
  const session = await startSession(routine);
  await logSet({
    sessionId: session.id, exerciseId: fly.id, setType: 'working',
    unit: 'lb', weight: 30, reps: 12,
  });

  renderScreen();

  // Derived from the logged sets, so it survives a reload with no storage.
  expect(await screen.findByRole('button', { name: /cable fly/i })).toBeInTheDocument();
});

it('finishes the session and advances the rotation', async () => {
  const user = userEvent.setup();
  const { routine } = await benchRoutine('Push A', 1);
  const other = await createRoutine('Pull A');
  const cycle = await (await import('../../db/cycles')).getOrCreateActiveCycle();
  await (await import('../../db/cycles')).saveCycle({
    ...cycle, routineIds: [routine.id, other.id], currentIndex: 0,
  });
  const session = await startSession(routine);

  renderScreen();

  await user.click(await screen.findByRole('button', { name: /finish workout/i }));

  expect(await screen.findByText('Today screen')).toBeInTheDocument();
  const { getSession } = await import('../../db/sessions');
  expect((await getSession(session.id))?.status).toBe('completed');
  const { getActiveCycle } = await import('../../db/cycles');
  expect((await getActiveCycle())?.currentIndex).toBe(1);
});

it('asks before discarding', async () => {
  const user = userEvent.setup();
  const { routine } = await benchRoutine('Push A', 1);
  const session = await startSession(routine);

  renderScreen();

  await user.click(await screen.findByRole('button', { name: /discard workout/i }));
  // Nothing is gone until the confirmation is taken.
  const { getSession } = await import('../../db/sessions');
  expect(await getSession(session.id)).toBeDefined();

  await user.click(await screen.findByRole('button', { name: /yes, discard it/i }));

  expect(await screen.findByText('Today screen')).toBeInTheDocument();
  expect(await getSession(session.id)).toBeUndefined();
});

it('keeps a way out when the routine is emptied mid-session', async () => {
  // Start Push A, then remove its only exercise from the routine. The screen
  // has nothing to log — but Today offers Resume rather than Start while a
  // session is open, and startSession refuses a different routine, so a
  // branch with no Finish and no Discard is a soft-lock whose only escape is
  // clearing site data. That takes every logged workout with it.
  const user = userEvent.setup();
  const { routine } = await benchRoutine('Push A', 3);
  const session = await startSession(routine);
  await setRoutineItems(routine.id, []);

  renderScreen();

  expect(await screen.findByText(/no exercises/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /finish workout/i })).toBeInTheDocument();
  // The constructive escape, reachable from the same branch.
  expect(screen.getByRole('button', { name: /add exercise/i })).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /discard workout/i }));
  await user.click(await screen.findByRole('button', { name: /yes, discard it/i }));

  expect(await screen.findByText('Today screen')).toBeInTheDocument();
  const { getSession } = await import('../../db/sessions');
  expect(await getSession(session.id)).toBeUndefined();
});

it('takes the logged sets with a discarded session', async () => {
  const user = userEvent.setup();
  const { exercise, routine } = await benchRoutine('Push A', 1);
  const session = await startSession(routine);
  await logSet({
    sessionId: session.id, exerciseId: exercise.id, setType: 'working',
    unit: 'lb', weight: 135, reps: 8,
  });

  renderScreen();

  await user.click(await screen.findByRole('button', { name: /discard workout/i }));
  await user.click(await screen.findByRole('button', { name: /yes, discard it/i }));

  await waitFor(async () => {
    expect(await listSetsForSession(session.id)).toHaveLength(0);
  });
});
