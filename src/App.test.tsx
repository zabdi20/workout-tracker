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

it('routes /history to the History screen', async () => {
  const base = import.meta.env.BASE_URL;
  window.history.pushState({}, '', `${base}history`);
  try {
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'History' }, { timeout: 5000 })).toBeInTheDocument();
    await expect.poll(() => db.exercises.count()).toBeGreaterThan(100);
  } finally {
    window.history.pushState({}, '', base);
  }
});
