import type { Exercise } from '../../db/types';
import { equipmentLabel, muscleLabel } from '../../domain/labels';

interface Props {
  exercises: Exercise[];
  onSelect?: (exercise: Exercise) => void;
}

export function ExerciseList({ exercises, onSelect }: Props) {
  if (exercises.length === 0) {
    return <p className="empty">No exercises match those filters.</p>;
  }

  return (
    <ul className="exercise-list">
      {exercises.map((exercise) => (
        <li key={exercise.id}>
          <button type="button" onClick={() => onSelect?.(exercise)}>
            <span className="exercise-name">{exercise.name}</span>
            <span className="exercise-meta">
              {exercise.primaryMuscles.map(muscleLabel).join(', ')}
              {' · '}
              {equipmentLabel(exercise.equipment)}
              {exercise.isCustom && ' · Custom'}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
