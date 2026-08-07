import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetDbForTests } from '../../db/db';
import { createCustomExercise } from '../../db/exercises';
import { LibraryScreen } from './LibraryScreen';

beforeEach(async () => {
  await resetDbForTests();
  await createCustomExercise({
    name: 'Barbell Bench Press', primaryMuscles: ['chest'],
    secondaryMuscles: ['triceps'], equipment: 'barbell',
    measurementType: 'weight_reps',
  });
  await createCustomExercise({
    name: 'Barbell Squat', primaryMuscles: ['quads'],
    secondaryMuscles: ['glutes'], equipment: 'barbell',
    measurementType: 'weight_reps',
  });
});

it('lists exercises and narrows them as the user searches', async () => {
  const user = userEvent.setup();
  render(<LibraryScreen />);

  expect(await screen.findByText('Barbell Bench Press')).toBeInTheDocument();
  expect(screen.getByText('Barbell Squat')).toBeInTheDocument();

  await user.type(screen.getByRole('searchbox', { name: /search exercises/i }), 'squat');

  expect(await screen.findByText('Barbell Squat')).toBeInTheDocument();
  expect(screen.queryByText('Barbell Bench Press')).not.toBeInTheDocument();
});

it('tells the user when nothing matches', async () => {
  const user = userEvent.setup();
  render(<LibraryScreen />);

  await screen.findByText('Barbell Squat');
  await user.type(screen.getByRole('searchbox', { name: /search exercises/i }), 'zercher');

  expect(await screen.findByText(/no exercises match/i)).toBeInTheDocument();
});

it('filters by equipment', async () => {
  const user = userEvent.setup();
  await createCustomExercise({
    name: 'Cable Fly', primaryMuscles: ['chest'], secondaryMuscles: [],
    equipment: 'cable', measurementType: 'weight_reps',
  });

  render(<LibraryScreen />);
  await screen.findByText('Cable Fly');

  await user.click(screen.getByRole('button', { name: /filters/i }));
  await user.click(screen.getByRole('checkbox', { name: 'Cable' }));

  expect(await screen.findByText('Cable Fly')).toBeInTheDocument();
  expect(screen.queryByText('Barbell Squat')).not.toBeInTheDocument();
});

it('filters by muscle, matching secondary muscles too', async () => {
  const user = userEvent.setup();
  render(<LibraryScreen />);
  await screen.findByText('Barbell Squat');

  await user.click(screen.getByRole('button', { name: /filters/i }));
  await user.click(screen.getByRole('checkbox', { name: 'Triceps' }));

  // Bench lists triceps as a secondary muscle; squat does not work them.
  expect(await screen.findByText('Barbell Bench Press')).toBeInTheDocument();
  expect(screen.queryByText('Barbell Squat')).not.toBeInTheDocument();
});

it('clears all filters at once', async () => {
  const user = userEvent.setup();
  render(<LibraryScreen />);
  await screen.findByText('Barbell Squat');

  await user.click(screen.getByRole('button', { name: /filters/i }));
  await user.click(screen.getByRole('checkbox', { name: 'Triceps' }));
  await screen.findByText('Barbell Bench Press');

  await user.click(screen.getByRole('button', { name: /clear filters/i }));

  expect(await screen.findByText('Barbell Squat')).toBeInTheDocument();
  expect(screen.getByText('Barbell Bench Press')).toBeInTheDocument();
});

it('swaps the edit form to the newly clicked exercise instead of keeping the stale one open', async () => {
  const user = userEvent.setup();
  await createCustomExercise({
    name: 'Cable Fly', primaryMuscles: ['chest'], secondaryMuscles: [],
    equipment: 'cable', measurementType: 'weight_reps',
  });
  await createCustomExercise({
    name: 'Pec Deck', primaryMuscles: ['chest'], secondaryMuscles: [],
    equipment: 'machine', measurementType: 'weight_reps',
  });

  render(<LibraryScreen />);
  await screen.findByText('Cable Fly');

  await user.click(screen.getByText('Cable Fly'));
  expect(await screen.findByLabelText(/exercise name/i)).toHaveValue('Cable Fly');

  // Without closing the form, click a different custom exercise.
  await user.click(screen.getByText('Pec Deck'));

  expect(await screen.findByLabelText(/exercise name/i)).toHaveValue('Pec Deck');
});
