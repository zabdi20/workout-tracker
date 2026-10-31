import { useState, type FormEvent } from 'react';
import type { Equipment, Exercise, MeasurementType, MuscleGroup } from '../../db/types';
import {
  archiveExercise, createCustomExercise, resetExerciseToBundled, updateExercise,
} from '../../db/exercises';
import {
  EQUIPMENT_TYPES, MUSCLE_GROUPS, equipmentLabel, muscleLabel,
} from '../../domain/labels';
import { useWriteError } from '../useWriteError';
import { WriteErrorAlert } from '../WriteErrorAlert';

const MEASUREMENT_TYPES: Array<[MeasurementType, string]> = [
  ['weight_reps', 'Weight × reps'],
  ['bodyweight_reps', 'Bodyweight reps'],
  ['assisted_reps', 'Assisted reps'],
  ['duration', 'Duration'],
  ['distance_duration', 'Distance & duration'],
  ['weight_duration', 'Weight & duration'],
];

interface Props {
  existing?: Exercise;
  onDone: () => void;
  onCancel: () => void;
}

export function CustomExerciseForm({ existing, onDone, onCancel }: Props) {
  const [name, setName] = useState(existing?.name ?? '');
  const [equipment, setEquipment] = useState<Equipment>(existing?.equipment ?? 'barbell');
  const [primary, setPrimary] = useState<MuscleGroup | ''>(
    existing?.primaryMuscles[0] ?? '',
  );
  const [measurementType, setMeasurementType] = useState<MeasurementType>(
    existing?.measurementType ?? 'weight_reps',
  );
  // One error surface for the whole form. The validation checks throw inside
  // `run` rather than setting a message of their own, so a bad field and a
  // failed write show in the same place. `onDone` runs only when `run`
  // resolves true: a failed save (a full disk especially) must leave the form
  // open with what the user typed still in it.
  const { error, run } = useWriteError();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const saved = await run(async () => {
      if (!name.trim()) throw new Error('Exercise name is required');
      if (!primary) throw new Error('A primary muscle is required');

      if (existing) {
        await updateExercise(existing.id, {
          name: name.trim(),
          equipment,
          primaryMuscles: [primary],
          measurementType,
        });
      } else {
        await createCustomExercise({
          name: name.trim(),
          equipment,
          primaryMuscles: [primary],
          secondaryMuscles: [],
          measurementType,
        });
      }
    });
    if (saved) onDone();
  }

  async function handleArchive() {
    if (!existing) return;
    if (await run(() => archiveExercise(existing.id))) onDone();
  }

  async function handleReset() {
    if (!existing) return;
    if (await run(() => resetExerciseToBundled(existing.id))) onDone();
  }

  return (
    <form onSubmit={handleSubmit}>
      <h3>{existing ? 'Edit exercise' : 'New exercise'}</h3>

      <WriteErrorAlert error={error} />

      <label>
        Exercise name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>

      <label>
        Equipment
        <select value={equipment} onChange={(e) => setEquipment(e.target.value as Equipment)}>
          {EQUIPMENT_TYPES.map((eq) => (
            <option key={eq} value={eq}>{equipmentLabel(eq)}</option>
          ))}
        </select>
      </label>

      <label>
        Primary muscle
        <select
          value={primary}
          onChange={(e) => setPrimary(e.target.value as MuscleGroup | '')}
        >
          <option value="">Select a muscle…</option>
          {MUSCLE_GROUPS.map((m) => (
            <option key={m} value={m}>{muscleLabel(m)}</option>
          ))}
        </select>
      </label>

      <label>
        Measurement
        <select
          value={measurementType}
          onChange={(e) => setMeasurementType(e.target.value as MeasurementType)}
        >
          {MEASUREMENT_TYPES.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>

      <button type="submit">Save</button>
      <button type="button" onClick={onCancel}>Cancel</button>
      {existing && (
        <button type="button" onClick={handleArchive}>Archive</button>
      )}
      {existing && !existing.isCustom && (
        <button type="button" onClick={handleReset}>Reset to bundled</button>
      )}
    </form>
  );
}
