import { render, screen } from '@testing-library/react';
import { App } from './App';

test('renders the app shell with its title', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: /workout tracker/i })).toBeInTheDocument();
});
