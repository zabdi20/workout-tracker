import { useEffect, useRef } from 'react';

/**
 * Holds a Screen Wake Lock for as long as `shouldHold` is true.
 *
 * Deliberately dumb: the caller owns the condition. The rest timer's version
 * of it lives in src/domain/restTimer.ts as shouldHoldWakeLock, where it is
 * testable without a browser.
 *
 * Best-effort throughout. navigator.wakeLock is absent in jsdom and rejects
 * when the document is not visible; either way the screen simply sleeps on
 * its normal timeout, which is not worth surfacing to someone mid-set.
 *
 * iOS releases the lock whenever the document hides and never restores it, so
 * re-acquisition matters. It happens naturally here: visibility is part of
 * the caller's condition, and a visibility change re-renders.
 */
export function useWakeLock(shouldHold: boolean): void {
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    let cancelled = false;

    function release() {
      const sentinel = sentinelRef.current;
      sentinelRef.current = null;
      // Nothing to do about a failed release: the lock is the browser's, and
      // a rejection here means it is already gone.
      if (sentinel) void sentinel.release().catch(() => {});
    }

    async function acquire() {
      // No dedup guard here: this only runs when the effect (re)runs, which
      // only happens when `shouldHold` changes, and cleanup always nulls
      // sentinelRef before the next run. A ref-based "already holding one"
      // check would be unreachable dead code.
      try {
        const sentinel = await navigator.wakeLock?.request('screen');
        if (!sentinel) return;
        if (cancelled) {
          // The condition went false while the request was in flight.
          // Releasing rather than storing keeps a lock from outliving it.
          void sentinel.release().catch(() => {});
          return;
        }
        sentinelRef.current = sentinel;
        // The browser drops the lock on its own when the document hides.
        // Without this the ref would still hold the dead sentinel, and the
        // next cleanup would call release() on it again for no reason.
        sentinel.addEventListener('release', () => {
          sentinelRef.current = null;
        });
      } catch {
        // No lock. Nothing else changes.
      }
    }

    if (shouldHold) void acquire();
    else release();

    return () => {
      cancelled = true;
      release();
    };
  }, [shouldHold]);
}
