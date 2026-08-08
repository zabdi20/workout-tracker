import { render, screen } from '@testing-library/react';
import { db, resetDbForTests } from './db/db';
import { App } from './App';

beforeEach(async () => {
  await resetDbForTests();
});

it('renders the app title', async () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /workout tracker/i })).toBeInTheDocument();
});

it('seeds the library on first run', async () => {
  render(<App />);
  // Wait for seeding to finish before asserting, so the assertion is not
  // racing an in-flight promise.
  await screen.findByRole('navigation', { name: 'Sections' });
  await screen.findByRole('link', { name: 'Library' });
  await expect.poll(() => db.exercises.count()).toBeGreaterThan(100);
});
