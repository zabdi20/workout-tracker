import { render, screen, within } from '@testing-library/react';
import { STORAGE_FULL_MESSAGE } from './useWriteError';
import { WriteErrorAlert } from './WriteErrorAlert';

it('offers a backup beside the storage-full message, in one alert', () => {
  render(<WriteErrorAlert error={STORAGE_FULL_MESSAGE} />);
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent(STORAGE_FULL_MESSAGE);
  expect(within(alert).getByRole('button', { name: 'Back up now' })).toBeInTheDocument();
  expect(screen.getAllByRole('alert')).toHaveLength(1);
});

it('shows any other message on its own, with no backup button', () => {
  render(<WriteErrorAlert error="Routine name is required" />);
  expect(screen.getByRole('alert')).toHaveTextContent('Routine name is required');
  expect(screen.queryByRole('button')).toBeNull();
});

it('renders no alert when there is no error', () => {
  render(<WriteErrorAlert error={null} />);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
});
