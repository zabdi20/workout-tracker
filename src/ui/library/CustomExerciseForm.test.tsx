import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetDbForTests } from '../../db/db';
import {
  createCustomExercise, listExercises, getExercise, updateExercise,
} from '../../db/exercises';
import { prepareLibrary } from '../../db/seed';
import type { Exercise } from '../../db/types';
import { CustomExerciseForm } from './CustomExerciseForm';

beforeEach(async () => {
  await resetDbForTests();
});

async function fillRequired(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.type(screen.getByLabelText(/exercise name/i), name);
  await user.selectOptions(screen.getByLabelText(/equipment/i), 'machine');
  await user.selectOptions(screen.getByLabelText(/primary muscle/i), 'lats');
}

it('creates a custom exercise', async () => {
  const user = userEvent.setup();
  const onDone = vi.fn();
  render(<CustomExerciseForm onDone={onDone} onCancel={vi.fn()} />);

  await fillRequired(user, 'Hammer Strength Row');
  await user.click(screen.getByRole('button', { name: /save/i }));

  const all = await listExercises();
  expect(all.map((e) => e.name)).toEqual(['Hammer Strength Row']);
  expect(all[0].isCustom).toBe(true);
  expect(all[0].primaryMuscles).toEqual(['lats']);
  expect(onDone).toHaveBeenCalledOnce();
});

it('refuses to save without a name and does not call onDone', async () => {
  const user = userEvent.setup();
  const onDone = vi.fn();
  render(<CustomExerciseForm onDone={onDone} onCancel={vi.fn()} />);

  await user.selectOptions(screen.getByLabelText(/primary muscle/i), 'lats');
  await user.click(screen.getByRole('button', { name: /save/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/name/i);
  expect(await listExercises()).toHaveLength(0);
  expect(onDone).not.toHaveBeenCalled();
});

it('refuses to save without a primary muscle', async () => {
  const user = userEvent.setup();
  render(<CustomExerciseForm onDone={vi.fn()} onCancel={vi.fn()} />);

  await user.type(screen.getByLabelText(/exercise name/i), 'Mystery Move');
  await user.click(screen.getByRole('button', { name: /save/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/primary muscle/i);
  expect(await listExercises()).toHaveLength(0);
});

it('edits an existing exercise', async () => {
  const user = userEvent.setup();
  const existing = await createCustomExercise({
    name: 'Cable Fly', primaryMuscles: ['chest'], secondaryMuscles: [],
    equipment: 'cable', measurementType: 'weight_reps',
  });

  render(<CustomExerciseForm existing={existing} onDone={vi.fn()} onCancel={vi.fn()} />);

  const nameField = screen.getByLabelText(/exercise name/i);
  await user.clear(nameField);
  await user.type(nameField, 'Low-to-High Cable Fly');
  await user.click(screen.getByRole('button', { name: /save/i }));

  expect((await getExercise(existing.id))?.name).toBe('Low-to-High Cable Fly');
});

it('archives rather than deletes', async () => {
  const user = userEvent.setup();
  const existing = await createCustomExercise({
    name: 'Cable Fly', primaryMuscles: ['chest'], secondaryMuscles: [],
    equipment: 'cable', measurementType: 'weight_reps',
  });

  render(<CustomExerciseForm existing={existing} onDone={vi.fn()} onCancel={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: /archive/i }));

  expect((await getExercise(existing.id))?.isArchived).toBe(true);
  expect(await listExercises()).toHaveLength(0);
});

it('offers Reset to bundled only for bundled exercises', async () => {
  await prepareLibrary();
  const bundledExercise = (await listExercises()).find((e) => !e.isCustom)!;

  render(
    <CustomExerciseForm existing={bundledExercise} onDone={vi.fn()} onCancel={vi.fn()} />,
  );

  expect(screen.getByRole('button', { name: /reset to bundled/i })).toBeInTheDocument();
});

it('hides Reset to bundled for custom exercises', async () => {
  const custom = await createCustomExercise({
    name: 'Explosive Box Step-Up',
    primaryMuscles: ['quads'],
    secondaryMuscles: [],
    equipment: 'bodyweight',
    measurementType: 'bodyweight_reps',
  });

  render(<CustomExerciseForm existing={custom} onDone={vi.fn()} onCancel={vi.fn()} />);

  expect(screen.queryByRole('button', { name: /reset to bundled/i })).toBeNull();
});

it('restores the shipped data when reset is pressed', async () => {
  const user = userEvent.setup();
  await prepareLibrary();
  const original = (await listExercises()).find((e) => !e.isCustom)!;
  await updateExercise(original.id, { name: 'Renamed', measurementType: 'duration' });
  const edited = (await getExercise(original.id))!;

  const onDone = vi.fn();
  render(<CustomExerciseForm existing={edited} onDone={onDone} onCancel={vi.fn()} />);

  await user.click(screen.getByRole('button', { name: /reset to bundled/i }));

  await waitFor(() => expect(onDone).toHaveBeenCalled());
  const restored = await getExercise(original.id);
  expect(restored?.name).toBe(original.name);
  expect(restored?.measurementType).toBe(original.measurementType);
});

it('surfaces an error and does not close the form when reset fails', async () => {
  // resetExerciseToBundled rejects for any id absent from the bundled JSON
  // — a real, unmocked rejection trigger. This pins the actual defect the
  // try/catch in handleReset (and, by the same shape, handleArchive) fixed:
  // an unhandled rejection used to leave the form open with no explanation.
  // A passing test here requires both halves: the alert renders, and
  // onDone is not called as though the write had succeeded.
  const user = userEvent.setup();
  const existing: Exercise = {
    id: 'not-a-real-bundled-id',
    name: 'Side to Side Box Shuffle',
    primaryMuscles: ['quads'],
    secondaryMuscles: [],
    equipment: 'other',
    measurementType: 'bodyweight_reps',
    isCustom: false,
    isArchived: false,
  };
  const onDone = vi.fn();

  render(<CustomExerciseForm existing={existing} onDone={onDone} onCancel={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: /reset to bundled/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/bundled/i);
  expect(onDone).not.toHaveBeenCalled();
});

it('waits for the archive write before closing the form', async () => {
  // Pins that handleArchive awaits archiveExercise before calling onDone,
  // rather than closing the form as soon as the write is issued: if onDone
  // fired before the write settled, the row would not yet be archived when
  // this assertion runs. (Error-surfacing on a rejected write is covered
  // separately, by the handleReset failure test above — the two handlers
  // are verbatim the same shape.)
  const user = userEvent.setup();
  const custom = await createCustomExercise({
    name: 'Explosive Box Step-Up',
    primaryMuscles: ['quads'],
    secondaryMuscles: [],
    equipment: 'bodyweight',
    measurementType: 'bodyweight_reps',
  });
  const onDone = vi.fn();

  render(<CustomExerciseForm existing={custom} onDone={onDone} onCancel={vi.fn()} />);
  await user.click(screen.getByRole('button', { name: /archive/i }));

  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect((await getExercise(custom.id))?.isArchived).toBe(true);
});
