import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { resetDbForTests } from '../db/db';
import { AppLayout } from './AppLayout';

beforeEach(async () => {
  await resetDbForTests();
});

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

it('renders the routed child', async () => {
  renderAt('/routines');
  expect(await screen.findByText('routines here')).toBeInTheDocument();
});

it('offers navigation to each section', async () => {
  renderAt('/');
  expect(await screen.findByRole('link', { name: 'Today' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Routines' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Library' })).toBeInTheDocument();
});

it('marks the current section as current', async () => {
  renderAt('/routines');
  const current = await screen.findByRole('link', { name: 'Routines' });
  expect(current).toHaveAttribute('aria-current', 'page');
});
