import { render, screen } from '@testing-library/react';
import { resetDbForTests, db } from './db/db';
import { App } from './App';

beforeEach(async () => {
  await resetDbForTests();
});

it('renders the app title', async () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /workout tracker/i })).toBeInTheDocument();
});

it('seeds the library on first run and shows it', async () => {
  render(<App />);
  expect(await screen.findByRole('heading', { name: /exercises/i })).toBeInTheDocument();
  expect(await db.exercises.count()).toBeGreaterThan(100);
});
