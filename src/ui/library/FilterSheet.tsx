import type { Equipment, MuscleGroup } from '../../db/types';
import type { ExerciseFilter } from '../../domain/exerciseFilter';
import { equipmentLabel, muscleLabel } from '../../domain/labels';

interface Props {
  filter: ExerciseFilter;
  onChange: (filter: ExerciseFilter) => void;
  /** Muscles to offer as checkboxes, derived from the loaded exercises
   *  rather than the full type vocabulary -- see availableMuscles. */
  availableMuscles: MuscleGroup[];
  /** Equipment to offer as checkboxes -- see availableEquipment. */
  availableEquipment: Equipment[];
}

function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((v) => v !== value)
    : [...values, value];
}

export function FilterSheet({
  filter, onChange, availableMuscles, availableEquipment,
}: Props) {
  return (
    <div className="filter-sheet">
      <fieldset>
        <legend>Muscle</legend>
        {availableMuscles.map((muscle: MuscleGroup) => (
          <label key={muscle}>
            <input
              type="checkbox"
              checked={filter.muscles.includes(muscle)}
              onChange={() =>
                onChange({ ...filter, muscles: toggle(filter.muscles, muscle) })
              }
            />
            {muscleLabel(muscle)}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Equipment</legend>
        {availableEquipment.map((equipment: Equipment) => (
          <label key={equipment}>
            <input
              type="checkbox"
              checked={filter.equipment.includes(equipment)}
              onChange={() =>
                onChange({ ...filter, equipment: toggle(filter.equipment, equipment) })
              }
            />
            {equipmentLabel(equipment)}
          </label>
        ))}
      </fieldset>
    </div>
  );
}
