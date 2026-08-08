import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { seedExercisesIfEmpty } from '../db/seed';
import { AppLayout } from './AppLayout';

// This file mocks '../db/seed' for the whole module, which is why the
// seed-failure test lives here instead of in AppLayout.test.tsx: the other
// file's tests rely on the real seedExercisesIfEmpty running against a real
// (reset) IndexedDB, and mocking the module would make that no longer true.
vi.mock('../db/seed', () => ({
  seedExercisesIfEmpty: vi.fn(),
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
  vi.mocked(seedExercisesIfEmpty).mockRejectedValue(new Error('disk on fire'));

  renderAt('/routines');

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('disk on fire');
  expect(screen.queryByText('routines here')).toBeNull();
});

it('renders the routed child once seeding succeeds', async () => {
  vi.mocked(seedExercisesIfEmpty).mockResolvedValue(0);

  renderAt('/routines');

  expect(await screen.findByText('routines here')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
});
