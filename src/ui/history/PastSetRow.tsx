import { useState } from 'react';
import { deleteSet, updateSet } from '../../db/sets';
import { formatSet, measurementFields } from '../../domain/measurement';
import { PrBadge } from '../PrBadge';
import { SetFieldsForm } from './SetFieldsForm';
import type { useWriteError } from '../useWriteError';
import type { LoggedSet, MeasurementType } from '../../db/types';
import type { PrKind } from '../../domain/records';

interface PastSetRowProps {
  set: LoggedSet;
  /** Position within the exercise in this workout, counting from 1. */
  number: number;
  exerciseName: string;
  measurementType: MeasurementType;
  /** The record types this set earned, when it earned any. */
  kinds: PrKind[] | undefined;
  /** The screen's write runner, so one error line serves every control. */
  run: ReturnType<typeof useWriteError>['run'];
}

/**
 * One set of a finished workout: its text and PR badge, with Edit and Delete.
 * Edit swaps the row for a form that holds its own draft.
 */
export function PastSetRow({
  set,
  number,
  exerciseName,
  measurementType,
  kinds,
  run,
}: PastSetRowProps) {
  const [editing, setEditing] = useState(false);
  const name = `${exerciseName} set ${number}`;

  if (editing) {
    return (
      <li>
        <SetFieldsForm
          label={`Edit ${name}`}
          fields={measurementFields(measurementType)}
          seed={set}
          initialWarmup={set.setType === 'warmup'}
          // Weight keeps the unit it was logged in: no `unit` here, and
          // updateSet drops any `id`.
          onSave={(values, setType) => run(() => updateSet(set.id, { ...values, setType }))}
          onClose={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li>
      {/* All of the set's text lives in this one span, with the badge and the
          buttons beside it, so the text still matches exactly. The {' '} nodes
          keep them apart on screen, since nothing else does. */}
      <span>
        {`${number}. ${formatSet(set, measurementType)}${set.setType === 'warmup' ? ' (warm-up)' : ''}`}
      </span>{' '}
      {kinds && (
        <>
          <PrBadge kinds={kinds} />{' '}
        </>
      )}
      <button type="button" aria-label={`Edit ${name}`} onClick={() => setEditing(true)}>
        Edit
      </button>{' '}
      <button
        type="button"
        aria-label={`Delete ${name}`}
        // One tap, no confirmation, as removing a logged set is in the active
        // workout. There is no busy guard, and a fast second tap is not
        // harmless: deleting the same set twice would be, but the first delete
        // re-renders the list and the next row shifts up under the finger, so
        // the second tap deletes that other set. Nothing here locks the
        // button or offers an undo.
        onClick={() => void run(() => deleteSet(set.id))}
      >
        Delete
      </button>
    </li>
  );
}
