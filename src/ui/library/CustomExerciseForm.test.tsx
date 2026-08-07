import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetDbForTests } from '../../db/db';
import { createCustomExercise, listExercises, getExercise } from '../../db/exercises';
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
