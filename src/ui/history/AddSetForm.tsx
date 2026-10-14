import { useState } from 'react';
import { addForgottenSet } from '../../db/sets';
import { measurementFields } from '../../domain/measurement';
import { SetFieldsForm } from './SetFieldsForm';
import type { useWriteError } from '../useWriteError';
import type { LoggedSet, MeasurementType } from '../../db/types';

interface AddSetFormProps {
  sessionId: string;
  exerciseId: string;
  exerciseName: string;
  measurementType: MeasurementType;
  /** The exercise's last set in this workout. Its values and unit prefill the
   *  fields, so a forgotten set is usually one tap away from right. */
  lastSet: LoggedSet;
  /** The screen's write runner, so one error line serves every control. */
  run: ReturnType<typeof useWriteError>['run'];
}

/**
 * Under each exercise of a finished workout: a control that opens a form for a
 * set the user forgot to log. The new set lands after the exercise's last one,
 * inside the workout's own timespan, which addForgottenSet takes care of.
 */
export function AddSetForm({
  sessionId,
  exerciseId,
  exerciseName,
  measurementType,
  lastSet,
  run,
}: AddSetFormProps) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" aria-label={`Add set to ${exerciseName}`} onClick={() => setOpen(true)}>
        Add set
      </button>
    );
  }

  return (
    <SetFieldsForm
      label={`Add a set to ${exerciseName}`}
      fields={measurementFields(measurementType)}
      seed={lastSet}
      initialWarmup={false}
      onSave={(values, setType) =>
        run(() =>
          addForgottenSet({ sessionId, exerciseId, unit: lastSet.unit, setType, ...values }),
        )
      }
      onClose={() => setOpen(false)}
    />
  );
}
