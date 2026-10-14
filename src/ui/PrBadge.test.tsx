import { render, screen } from '@testing-library/react';
import { PrBadge } from './PrBadge';

it('names every kind a set earned, in order', () => {
  render(<PrBadge kinds={['heaviest', 'e1rm', 'reps']} />);
  expect(screen.getByText('PR: heaviest, est. 1RM, rep best')).toBeInTheDocument();
});
