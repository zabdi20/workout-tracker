import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RestBanner } from './RestBanner';

it('shows the time left while rest is running', () => {
  render(<RestBanner view={{ phase: 'counting', remainingSeconds: 84 }} onSkip={() => {}} />);
  expect(screen.getByText(/rest 1:24/i)).toBeInTheDocument();
});

it('says how long ago rest ended, rather than showing a bare zero', () => {
  // Returning after rest has elapsed is the normal flow on iOS, not an edge
  // case, so 0:00 would hide the thing the user most needs to know.
  render(<RestBanner view={{ phase: 'elapsed', overrunSeconds: 184 }} onSkip={() => {}} />);
  expect(screen.getByText(/rest done/i)).toBeInTheDocument();
  expect(screen.getByText(/3:04 over/i)).toBeInTheDocument();
});

it('offers to skip a running rest', async () => {
  const user = userEvent.setup();
  const onSkip = vi.fn();
  render(<RestBanner view={{ phase: 'counting', remainingSeconds: 84 }} onSkip={onSkip} />);

  await user.click(screen.getByRole('button', { name: /skip rest/i }));

  expect(onSkip).toHaveBeenCalledTimes(1);
});

it('offers to dismiss one that is already over', async () => {
  // "Skip" is a lie for something finished.
  const user = userEvent.setup();
  const onSkip = vi.fn();
  render(<RestBanner view={{ phase: 'elapsed', overrunSeconds: 12 }} onSkip={onSkip} />);

  await user.click(screen.getByRole('button', { name: /dismiss/i }));

  expect(onSkip).toHaveBeenCalledTimes(1);
});
