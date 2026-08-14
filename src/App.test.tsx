import { render, screen } from '@testing-library/react';
import { db, resetDbForTests } from './db/db';
import { App } from './App';

beforeEach(async () => {
  await resetDbForTests();
});

it('renders the app title', async () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /workout tracker/i })).toBeInTheDocument();
  // Let the seeding started by render() settle inside this test, rather than
  // leaving its transaction in flight when the next test's beforeEach calls
  // resetDbForTests().
  await expect.poll(() => db.exercises.count()).toBeGreaterThan(100);
});

it('seeds the library on first run', async () => {
  render(<App />);
  await expect.poll(() => db.exercises.count()).toBeGreaterThan(100);
});
