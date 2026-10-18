import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { db, resetDbForTests } from '../../db/db';
import { createCustomExercise } from '../../db/exercises';
import { LibraryScreen } from './LibraryScreen';

// The Library links to an exercise's records page, so it needs a router.
function renderLibrary() {
  return render(
    <MemoryRouter>
      <LibraryScreen />
    </MemoryRouter>,
  );
}

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
  renderLibrary();

  expect(await screen.findByText('Barbell Bench Press')).toBeInTheDocument();
  expect(screen.getByText('Barbell Squat')).toBeInTheDocument();

  await user.type(screen.getByRole('searchbox', { name: /search exercises/i }), 'squat');

  expect(await screen.findByText('Barbell Squat')).toBeInTheDocument();
  expect(screen.queryByText('Barbell Bench Press')).not.toBeInTheDocument();
});

it('tells the user when nothing matches', async () => {
  const user = userEvent.setup();
  renderLibrary();

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

  renderLibrary();
  await screen.findByText('Cable Fly');

  await user.click(screen.getByRole('button', { name: /^filters/i }));
  await user.click(screen.getByRole('checkbox', { name: 'Cable' }));

  expect(await screen.findByText('Cable Fly')).toBeInTheDocument();
  expect(screen.queryByText('Barbell Squat')).not.toBeInTheDocument();
});

it('filters by muscle, matching secondary muscles too', async () => {
  const user = userEvent.setup();
  renderLibrary();
  await screen.findByText('Barbell Squat');

  await user.click(screen.getByRole('button', { name: /^filters/i }));
  await user.click(screen.getByRole('checkbox', { name: 'Triceps' }));

  // Bench lists triceps as a secondary muscle; squat does not work them.
  expect(await screen.findByText('Barbell Bench Press')).toBeInTheDocument();
  expect(screen.queryByText('Barbell Squat')).not.toBeInTheDocument();
});

it('clears all filters at once', async () => {
  const user = userEvent.setup();
  renderLibrary();
  await screen.findByText('Barbell Squat');

  await user.click(screen.getByRole('button', { name: /^filters/i }));
  await user.click(screen.getByRole('checkbox', { name: 'Triceps' }));
  await screen.findByText('Barbell Bench Press');

  await user.click(screen.getByRole('button', { name: /clear filters/i }));

  expect(await screen.findByText('Barbell Squat')).toBeInTheDocument();
  expect(screen.getByText('Barbell Bench Press')).toBeInTheDocument();
});

it('does not render a filter checkbox for a muscle no loaded exercise uses', async () => {
  const user = userEvent.setup();
  renderLibrary();
  await screen.findByText('Barbell Squat');

  await user.click(screen.getByRole('button', { name: /^filters/i }));

  // The fixtures only work chest/triceps/quads/glutes -- never delts, which
  // sits right next to the (equally unused) front/side/rear delt variants
  // in the full MuscleGroup vocabulary.
  expect(screen.queryByRole('checkbox', { name: 'Shoulders' })).not.toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Triceps' })).toBeInTheDocument();
});

it('reflects the filter sheet open/closed state via aria-expanded', async () => {
  const user = userEvent.setup();
  renderLibrary();
  await screen.findByText('Barbell Squat');

  const toggle = screen.getByRole('button', { name: /^filters/i });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
});

it('pluralizes the exercise count correctly', async () => {
  const user = userEvent.setup();
  renderLibrary();
  await screen.findByText('Barbell Squat');
  expect(screen.getByText('2 exercises')).toBeInTheDocument();

  await user.type(screen.getByRole('searchbox', { name: /search exercises/i }), 'squat');
  expect(await screen.findByText('1 exercise')).toBeInTheDocument();
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

  renderLibrary();
  await screen.findByText('Cable Fly');

  await user.click(screen.getByText('Cable Fly'));
  expect(await screen.findByLabelText(/exercise name/i)).toHaveValue('Cable Fly');

  // Without closing the form, click a different custom exercise.
  await user.click(screen.getByText('Pec Deck'));

  expect(await screen.findByLabelText(/exercise name/i)).toHaveValue('Pec Deck');
});

it('opens the edit form for a bundled exercise', async () => {
  const user = userEvent.setup();
  // One bundled-shaped row inserted directly rather than seeding all 650.
  // Seeding would make the click ambiguous — many bundled names share a
  // prefix, and some contain regex metacharacters.
  await db.exercises.add({
    id: 'side-to-side-box-shuffle',
    name: 'Side to Side Box Shuffle',
    primaryMuscles: ['quads'],
    secondaryMuscles: [],
    equipment: 'other',
    measurementType: 'bodyweight_reps',
    isCustom: false,
    isArchived: false,
  });

  renderLibrary();

  await user.click(
    await screen.findByRole('button', { name: /side to side box shuffle/i }),
  );

  expect(await screen.findByRole('heading', { name: /edit exercise/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/exercise name/i)).toHaveValue('Side to Side Box Shuffle');
});

it('links an open exercise to its records', async () => {
  const user = userEvent.setup();
  renderLibrary();
  await user.click(await screen.findByRole('button', { name: /barbell bench press/i }));
  const bench = (await db.exercises.toArray()).find((e) => e.name === 'Barbell Bench Press')!;
  expect(await screen.findByRole('link', { name: 'Records' }))
    .toHaveAttribute('href', `/exercises/${bench.id}/records`);
});
