import { useState, type FormEvent } from 'react';
import type { Equipment, Exercise, MeasurementType, MuscleGroup } from '../../db/types';
import { archiveExercise, createCustomExercise, updateExercise } from '../../db/exercises';
import {
  EQUIPMENT_TYPES, MUSCLE_GROUPS, equipmentLabel, muscleLabel,
} from '../../domain/labels';

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
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Exercise name is required');
      return;
    }
    if (!primary) {
      setError('A primary muscle is required');
      return;
    }

    try {
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
      onDone();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleArchive() {
    if (!existing) return;
    await archiveExercise(existing.id);
    onDone();
  }

  return (
    <form onSubmit={handleSubmit}>
      <h3>{existing ? 'Edit exercise' : 'New exercise'}</h3>

      {error && <p role="alert">{error}</p>}

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
    </form>
  );
}
