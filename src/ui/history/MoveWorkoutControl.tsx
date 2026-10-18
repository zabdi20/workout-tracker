import { useState } from 'react';
import type { FormEvent } from 'react';
import { moveSession } from '../../db/sessions';
import { fromDateTimeLocalValue, toDateTimeLocalValue } from './format';
import type { useWriteError } from '../useWriteError';

interface MoveWorkoutControlProps {
  sessionId: string;
  /** The workout's stored start. Prefills the input each time it opens. */
  startedAt: number;
  /** The screen's write runner, so one error line serves every control. */
  run: ReturnType<typeof useWriteError>['run'];
}

/**
 * Under the date of a finished workout: a control that opens a date-and-time
 * input for when it started. Saving moves the whole workout, its sets with it,
 * which moveSession does in one transaction.
 *
 * The draft is this control's own state, set when the form opens and `null`
 * while it is closed. The screen above re-renders on every write to the
 * database; a draft derived from `startedAt` would be overwritten by the next
 * re-render.
 *
 * The form closes only when the write landed. A refused move (into the future,
 * say) leaves it open with the value the user typed, so they can correct it
 * rather than retype it.
 */
export function MoveWorkoutControl({ sessionId, startedAt, run }: MoveWorkoutControlProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent, value: string) {
    e.preventDefault();
    if (busy) return;

    // An empty or unreadable value has nothing to write, and the form stays
    // open: the same no-op a set form makes when none of its fields parse.
    const newStartedAt = fromDateTimeLocalValue(value);
    if (Number.isNaN(newStartedAt)) return;

    setBusy(true);
    const wrote = await run(() => moveSession(sessionId, newStartedAt));
    // Cleared either way: unlike a set form, this control stays mounted when
    // the write lands, and on failure a Save that stayed disabled would trade
    // a recoverable error for a form the user cannot do anything with.
    setBusy(false);
    if (wrote) setDraft(null);
  }

  if (draft === null) {
    return (
      <button type="button" onClick={() => setDraft(toDateTimeLocalValue(startedAt))}>
        Change date and time
      </button>
    );
  }

  return (
    // noValidate: left to itself the browser checks the value against the
    // input's step, min and max before submit and refuses with a message that
    // nothing here is wired to show, leaving Save to do nothing. Whether the
    // value reads as a time is fromDateTimeLocalValue's call, and the rest is
    // moveSession's.
    <form aria-label="Change date and time" noValidate onSubmit={(e) => void submit(e, draft)}>
      <label>
        Workout start
        <input
          type="datetime-local"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </label>

      <button type="submit" disabled={busy}>Save</button>
      <button type="button" onClick={() => setDraft(null)}>Cancel</button>
    </form>
  );
}
