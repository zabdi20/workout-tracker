import { useState } from 'react';

/**
 * Runs a database write and surfaces any failure as a message the caller can
 * render. An event handler that calls a write directly is fire-and-forget: on
 * rejection the user sees nothing while the app looks like it worked, which the
 * spec explicitly forbids. Three screens need this, so it lives in one place.
 *
 * `run` resolves `true` when the write landed and `false` when it rejected —
 * the rejection is still swallowed into `error`, so it never throws. Callers
 * that must keep what the user typed on failure gate their cleanup on it:
 * `if (await run(...))`.
 */
export function useWriteError() {
  const [error, setError] = useState<string | null>(null);

  async function run(write: () => Promise<unknown>): Promise<boolean> {
    setError(null);
    try {
      await write();
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  return { error, run };
}
