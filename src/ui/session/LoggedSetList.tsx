import { formatSet } from '../../domain/measurement';
import type { LoggedSet, MeasurementType } from '../../db/types';

interface LoggedSetListProps {
  sets: LoggedSet[];
  measurementType: MeasurementType;
  onRemove: (setId: string) => void;
}

/**
 * The confirmed sets for the focused exercise.
 *
 * Display numbering is the position in this sorted array, not LoggedSet.order
 * — that is a monotonic sort key which deliberately leaves a gap when a set is
 * deleted.
 */
export function LoggedSetList({ sets, measurementType, onRemove }: LoggedSetListProps) {
  return (
    <ol className="logged-sets">
      {sets.map((set, index) => (
        <li key={set.id}>
          <span>
            {index + 1}. {formatSet(set, measurementType)}
            {set.setType === 'warmup' && ' (warm-up)'}
          </span>
          <button
            type="button"
            aria-label={`Remove logged set ${index + 1}`}
            onClick={() => onRemove(set.id)}
          >
            Remove
          </button>
        </li>
      ))}
    </ol>
  );
}
