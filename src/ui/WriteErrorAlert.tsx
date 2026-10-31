import { BackupButton } from './backup/BackupButton';
import { STORAGE_FULL_MESSAGE } from './useWriteError';

/**
 * Renders the `error` from useWriteError. A full disk gets the message and a
 * Back up now button in one alert; any other failure is just its message.
 */
export function WriteErrorAlert({ error }: { error: string | null }) {
  if (!error) return null;
  if (error === STORAGE_FULL_MESSAGE) {
    return (
      <div role="alert">
        <p>{error}</p>
        <BackupButton />
      </div>
    );
  }
  return <p role="alert">{error}</p>;
}
