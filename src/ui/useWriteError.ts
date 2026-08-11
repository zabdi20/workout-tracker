import { useState } from 'react';

/**
 * Runs a database write and surfaces any failure as a message the caller can
 * render. An event handler that calls a write directly is fire-and-forget: on
 * rejection the user sees nothing while the app looks like it worked, which the
 * spec explicitly forbids. Three screens need this, so it lives in one place.
 */
export function useWriteError() {
  const [error, setError] = useState<string | null>(null);

  async function run(write: () => Promise<unknown>): Promise<void> {
    setError(null);
    try {
      await write();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return { error, run };
}
