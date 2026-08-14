import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetDbForTests } from '../../db/db';
import { createRoutine } from '../../db/routines';
import { getOrCreateActiveCycle, saveCycle } from '../../db/cycles';
import { CycleEditor } from './CycleEditor';

beforeEach(async () => {
  await resetDbForTests();
});

it('shows an alert instead of a permanent loading state when bootstrap fails', async () => {
  const cycles = await import('../../db/cycles');
  const spy = vi.spyOn(cycles, 'getOrCreateActiveCycle')
    .mockRejectedValueOnce(new Error('disk on fire'));

  render(<CycleEditor />);

  expect(await screen.findByRole('alert')).toHaveTextContent(/disk on fire/i);
  spy.mockRestore();
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

it('removes only the tapped occurrence when a routine appears twice', async () => {
  // Removal is index-based, not routine-based: with the same routine in two
  // slots, only the Remove button that was actually clicked should remove
  // its slot, leaving the other occurrence untouched.
  const user = userEvent.setup();
  const a = await createRoutine('Push Day');
  const b = await createRoutine('Pull Day');
  const c = await getOrCreateActiveCycle();
  await saveCycle({ ...c, routineIds: [a.id, b.id, a.id] });

  render(<CycleEditor />);
  const removeButtons = await screen.findAllByRole('button', { name: /remove push day from rotation/i });
  expect(removeButtons).toHaveLength(2);
  await user.click(removeButtons[0]);

  await expect.poll(async () => (await getOrCreateActiveCycle()).routineIds)
    .toEqual([b.id, a.id]);
});
