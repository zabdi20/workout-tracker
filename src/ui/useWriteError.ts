import { useState } from 'react';

/**
 * What the user sees when a write fails because the phone has no room left.
 * The raw browser error ("QuotaExceededError") means nothing to them and does
 * not say what to do; the one thing that helps is a backup, so every screen
 * that shows a write error offers one beside this message (WriteErrorAlert).
 */
export const STORAGE_FULL_MESSAGE =
  "Couldn't save: your phone is out of space for this app. What you typed is still here. Back up now so nothing is lost.";

/**
 * Whether a failure is the browser reporting that storage is full. Dexie wraps
 * a transaction that aborts in an error whose `inner` holds the original, so
 * the chain is followed rather than only the top-level `name`.
 */
export function isQuotaError(e: unknown): boolean {
  // The `seen` guard keeps a cycle in an `inner` chain from looping forever.
  const seen = new Set<unknown>();
  let current: unknown = e;
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);
    const { name, inner } = current as { name?: unknown; inner?: unknown };
    if (name === 'QuotaExceededError') return true;
    current = inner;
  }
  return false;
}

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
 *
 * A full disk is stored as STORAGE_FULL_MESSAGE rather than the browser's own
 * wording; render the result with WriteErrorAlert so it comes with a backup
 * button.
 */
export function useWriteError() {
  const [error, setError] = useState<string | null>(null);

  async function run(write: () => Promise<unknown>): Promise<boolean> {
    setError(null);
    try {
      await write();
      return true;
    } catch (e: unknown) {
      setError(isQuotaError(e) ? STORAGE_FULL_MESSAGE : e instanceof Error ? e.message : String(e));
      return false;
    }
  }

  return { error, run };
}
