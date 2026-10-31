import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { prepareLibrary } from '../db/seed';
import { AppLayout } from './AppLayout';
import { STORAGE_FULL_MESSAGE } from './useWriteError';

// This file mocks '../db/seed' for the whole module, which is why the
// seed-failure test lives here instead of in AppLayout.test.tsx: the other
// file's tests rely on the real prepareLibrary running against a real
// (reset) IndexedDB, and mocking the module would make that no longer true.
vi.mock('../db/seed', () => ({
  prepareLibrary: vi.fn(),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<p>today here</p>} />
          <Route path="/routines" element={<p>routines here</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

it('shows an alert and does not render the routed child when seeding fails', async () => {
  vi.mocked(prepareLibrary).mockRejectedValue(new Error('disk on fire'));

  renderAt('/routines');

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('disk on fire');
  expect(alert).toHaveTextContent('Could not open the database');
  expect(within(alert).queryByRole('button')).toBeNull();
  expect(screen.queryByText('routines here')).toBeNull();
});

it('offers a backup when the library cannot be written for lack of space', async () => {
  vi.mocked(prepareLibrary).mockRejectedValue(new DOMException('full', 'QuotaExceededError'));

  renderAt('/routines');

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(STORAGE_FULL_MESSAGE);
  expect(alert).not.toHaveTextContent('Could not open the database');
  expect(within(alert).getByRole('button', { name: 'Back up now' })).toBeInTheDocument();
  expect(screen.queryByText('routines here')).toBeNull();
});

it('renders the routed child once seeding succeeds', async () => {
  vi.mocked(prepareLibrary).mockResolvedValue(0);

  renderAt('/routines');

  expect(await screen.findByText('routines here')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
});
