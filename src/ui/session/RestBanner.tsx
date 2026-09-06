import { formatDuration } from '../../domain/measurement';
import type { RestTimerView } from '../../domain/restTimer';

interface RestBannerProps {
  view: RestTimerView;
  onSkip: () => void;
}

/**
 * The live countdown. Session-global, not per-exercise: rest keeps running
 * when the user switches focus.
 *
 * Two explicit branches rather than one with ternaries, so the discriminated
 * union narrows without relying on an aliased condition.
 *
 * Deliberately not a live region. The text changes twice a second, so
 * role="status" would flood a screen reader rather than inform it.
 */
export function RestBanner({ view, onSkip }: RestBannerProps) {
  if (view.phase === 'counting') {
    return (
      <p className="rest-timer">
        Rest {formatDuration(view.remainingSeconds)}
        <button type="button" onClick={onSkip}>
          Skip rest
        </button>
      </p>
    );
  }
  return (
    <p className="rest-timer">
      Rest done — {formatDuration(view.overrunSeconds)} over
      <button type="button" onClick={onSkip}>
        Dismiss
      </button>
    </p>
  );
}
