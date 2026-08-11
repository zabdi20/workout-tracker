import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetDbForTests } from '../../db/db';
import { createRoutine } from '../../db/routines';
import { getOrCreateActiveCycle, saveCycle } from '../../db/cycles';
import { CycleEditor } from './CycleEditor';

beforeEach(async () => {
  await resetDbForTests();
});

it('tells the user when no routines exist yet', async () => {
  render(<CycleEditor />);
  expect(await screen.findByText(/create a routine first/i)).toBeInTheDocument();
});

it('adds a routine to the rotation', async () => {
  const user = userEvent.setup();
  const r = await createRoutine('Push Day');
  render(<CycleEditor />);

  await user.click(await screen.findByRole('button', { name: /add push day to rotation/i }));

  await expect.poll(async () => (await getOrCreateActiveCycle()).routineIds).toEqual([r.id]);
});

it('shows the rotation in order', async () => {
  const a = await createRoutine('Push Day');
  const b = await createRoutine('Pull Day');
  const c = await getOrCreateActiveCycle();
  await saveCycle({ ...c, routineIds: [a.id, b.id] });

  render(<CycleEditor />);

  const listed = await screen.findAllByTestId('cycle-slot-name');
  expect(listed.map((el) => el.textContent)).toEqual(['Push Day', 'Pull Day']);
});

it('moves a rotation entry up', async () => {
  const user = userEvent.setup();
  const a = await createRoutine('Push Day');
  const b = await createRoutine('Pull Day');
  const c = await getOrCreateActiveCycle();
  await saveCycle({ ...c, routineIds: [a.id, b.id] });

  render(<CycleEditor />);
  await screen.findAllByTestId('cycle-slot-name');
  await user.click(screen.getByRole('button', { name: /move pull day up/i }));

  await expect.poll(async () => (await getOrCreateActiveCycle()).routineIds)
    .toEqual([b.id, a.id]);
});

it('removes a rotation entry', async () => {
  const user = userEvent.setup();
  const a = await createRoutine('Push Day');
  const c = await getOrCreateActiveCycle();
  await saveCycle({ ...c, routineIds: [a.id] });

  render(<CycleEditor />);
  await screen.findAllByTestId('cycle-slot-name');
  await user.click(screen.getByRole('button', { name: /remove push day from rotation/i }));

  await expect.poll(async () => (await getOrCreateActiveCycle()).routineIds).toEqual([]);
});

it('allows the same routine twice in one rotation', async () => {
  const user = userEvent.setup();
  const a = await createRoutine('Push Day');
  const c = await getOrCreateActiveCycle();
  await saveCycle({ ...c, routineIds: [a.id] });

  render(<CycleEditor />);
  await screen.findAllByTestId('cycle-slot-name');
  await user.click(screen.getByRole('button', { name: /add push day to rotation/i }));

  await expect.poll(async () => (await getOrCreateActiveCycle()).routineIds)
    .toEqual([a.id, a.id]);
});
