import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { db, resetDbForTests } from '../../db/db';
import { archiveRoutine, createRoutine, listRoutines, setRoutineItems } from '../../db/routines';
import { STORAGE_FULL_MESSAGE } from '../useWriteError';
import { RoutinesScreen } from './RoutinesScreen';

beforeEach(async () => {
  await resetDbForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderScreen() {
  return render(
    <MemoryRouter>
      <RoutinesScreen />
    </MemoryRouter>,
  );
}

it('lists routines and links each to its editor', async () => {
  const r = await createRoutine('Push Day');
  renderScreen();

  const link = await screen.findByRole('link', { name: /push day/i });
  expect(link).toHaveAttribute('href', `/routines/${r.id}`);
});

it('tells the user when there are no routines yet', async () => {
  renderScreen();
  expect(await screen.findByText(/no routines yet/i)).toBeInTheDocument();
});

it('creates a routine', async () => {
  const user = userEvent.setup();
  renderScreen();
  await screen.findByText(/no routines yet/i);

  await user.type(screen.getByLabelText(/new routine name/i), 'Pull Day');
  await user.click(screen.getByRole('button', { name: /add routine/i }));

  expect(await screen.findByRole('link', { name: /pull day/i })).toBeInTheDocument();
  expect((await listRoutines()).map((r) => r.name)).toEqual(['Pull Day']);
});

it('refuses to create a routine with a blank name', async () => {
  const user = userEvent.setup();
  renderScreen();
  await screen.findByText(/no routines yet/i);

  await user.click(screen.getByRole('button', { name: /add routine/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/name/i);
  expect(await listRoutines()).toHaveLength(0);
});

it('archives a routine', async () => {
  const user = userEvent.setup();
  await createRoutine('Push Day');
  renderScreen();
  await screen.findByRole('link', { name: /push day/i });

  await user.click(screen.getByRole('button', { name: /archive push day/i }));

  expect(await screen.findByText(/no routines yet/i)).toBeInTheDocument();
  expect(await listRoutines()).toHaveLength(0);
});

it('shows how many exercises each routine holds', async () => {
  const r = await createRoutine('Push Day');
  await setRoutineItems(r.id, [
    { id: 'i1', exerciseId: 'bench', order: 0 },
    { id: 'i2', exerciseId: 'fly', order: 1 },
  ]);

  renderScreen();
  expect(await screen.findByText(/2 exercises/i)).toBeInTheDocument();
});

it('moves an archived routine into the Archived section', async () => {
  const user = userEvent.setup();
  await createRoutine('Push Day');
  renderScreen();
  await screen.findByRole('link', { name: /push day/i });
  expect(screen.queryByRole('heading', { name: /archived/i })).toBeNull();

  await user.click(screen.getByRole('button', { name: /archive push day/i }));

  expect(await screen.findByText(/no routines yet/i)).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: /archived/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /restore push day/i })).toBeInTheDocument();
});

it('restores an archived routine back to the main list', async () => {
  const user = userEvent.setup();
  const r = await createRoutine('Push Day');
  await archiveRoutine(r.id);
  renderScreen();
  await screen.findByRole('button', { name: /restore push day/i });

  await user.click(screen.getByRole('button', { name: /restore push day/i }));

  expect(await screen.findByRole('link', { name: /push day/i })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /archived/i })).toBeNull();
  expect((await listRoutines()).map((r) => r.name)).toEqual(['Push Day']);
});

it('has no Archived section when nothing is archived', async () => {
  await createRoutine('Push Day');
  renderScreen();
  await screen.findByRole('link', { name: /push day/i });

  expect(screen.queryByRole('heading', { name: /archived/i })).toBeNull();
});

it('surfaces an archive failure instead of failing silently', async () => {
  const user = userEvent.setup();
  await createRoutine('Push Day');
  renderScreen();
  await screen.findByRole('link', { name: /push day/i });

  const routines = await import('../../db/routines');
  const spy = vi.spyOn(routines, 'archiveRoutine')
    .mockRejectedValueOnce(new Error('quota exceeded'));

  await user.click(screen.getByRole('button', { name: /archive push day/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/quota exceeded/i);
  spy.mockRestore();
});

it('offers a backup when storage is full, keeping the typed name', async () => {
  const user = userEvent.setup();
  vi.spyOn(db.routines, 'add').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
  renderScreen();
  await user.type(screen.getByLabelText('New routine name'), 'Upper A');
  await user.click(screen.getByRole('button', { name: 'Add routine' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(STORAGE_FULL_MESSAGE);
  expect(within(alert).getByRole('button', { name: 'Back up now' })).toBeInTheDocument();
  expect(screen.getByLabelText('New routine name')).toHaveValue('Upper A');
});

it('offers a backup when storage is full while archiving', async () => {
  const user = userEvent.setup();
  await createRoutine('Push Day');
  vi.spyOn(db.routines, 'update').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
  renderScreen();
  await screen.findByRole('link', { name: /push day/i });
  await user.click(screen.getByRole('button', { name: 'Archive Push Day' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(STORAGE_FULL_MESSAGE);
  expect(within(alert).getByRole('button', { name: 'Back up now' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /push day/i })).toBeInTheDocument();
});

it('offers a backup when storage is full while restoring', async () => {
  const user = userEvent.setup();
  const r = await createRoutine('Push Day');
  await archiveRoutine(r.id);
  vi.spyOn(db.routines, 'update').mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
  renderScreen();
  await screen.findByRole('button', { name: 'Restore Push Day' });
  await user.click(screen.getByRole('button', { name: 'Restore Push Day' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(STORAGE_FULL_MESSAGE);
  expect(within(alert).getByRole('button', { name: 'Back up now' })).toBeInTheDocument();
});
