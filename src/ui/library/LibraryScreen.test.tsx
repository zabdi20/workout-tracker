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
