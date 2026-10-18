import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { deleteCompletedSession } from '../../db/sessions';
import type { useWriteError } from '../useWriteError';

interface DeleteWorkoutControlProps {
  sessionId: string;
  /** The screen's write runner, so one error line serves every control. */
  run: ReturnType<typeof useWriteError>['run'];
  /** Called with true as a delete begins and with false if it fails. While it
   *  is true and the workout is gone, the screen renders nothing in place of
   *  its "not found" message. */
  onLeaving: (leaving: boolean) => void;
}

/**
 * Deletes a finished workout and everything logged in it, behind the same
 * confirmation that Discard puts in front of the active one. Then it returns to
 * the list, because the page it is on no longer has a workout to show.
 *
 * It leaves the screen only when the delete landed. A failed one keeps the
 * confirmation open under the error, so the user can retry.
 */
export function DeleteWorkoutControl({ sessionId, run, onLeaving }: DeleteWorkoutControlProps) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (busy) return;
    setBusy(true);
    // Before the write, not after it: the screen must already be holding back
    // its not-found message when the delete lands.
    onLeaving(true);
    // replace: the workout's own page is gone, so Back from the list must not
    // land on a "Workout not found".
    if (await run(() => deleteCompletedSession(sessionId))) navigate('/history', { replace: true });
    // Cleared only on failure: on success this control is leaving the screen.
    else {
      onLeaving(false);
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)}>
        Delete workout
      </button>
    );
  }

  return (
    <p>
      Delete this workout and everything logged in it?{' '}
      <button type="button" disabled={busy} onClick={() => void remove()}>Yes, delete it</button>{' '}
      <button type="button" onClick={() => setConfirming(false)}>Keep it</button>
    </p>
  );
}
