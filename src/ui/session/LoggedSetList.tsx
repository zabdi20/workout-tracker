import { formatSet } from '../../domain/measurement';
import { PrBadge } from '../PrBadge';
import type { LoggedSet, MeasurementType } from '../../db/types';
import type { PrKind } from '../../domain/records';

interface LoggedSetListProps {
  sets: LoggedSet[];
  measurementType: MeasurementType;
  /** The record types each set earned, by set id. Sets that earned none are absent. */
  prs?: Map<string, PrKind[]>;
  onRemove: (setId: string) => void;
}

/**
 * The confirmed sets for the focused exercise.
 *
 * Display numbering is the position in this sorted array, not LoggedSet.order
 * — that is a monotonic sort key which deliberately leaves a gap when a set is
 * deleted.
 */
export function LoggedSetList({ sets, measurementType, prs, onRemove }: LoggedSetListProps) {
  return (
    <ol className="logged-sets">
      {sets.map((set, index) => {
        const kinds = prs?.get(set.id);
        return (
          <li key={set.id}>
            <span>
              {index + 1}. {formatSet(set, measurementType)}
              {set.setType === 'warmup' && ' (warm-up)'}
            </span>
            {/* The {' '} nodes keep the badge off the set's text and off the
                button, since nothing else does: it rendered flush as "× 5PR:". */}
            {kinds && (
              <>
                {' '}
                <PrBadge kinds={kinds} />{' '}
              </>
            )}
            <button
              type="button"
              aria-label={`Remove logged set ${index + 1}`}
              onClick={() => onRemove(set.id)}
            >
              Remove
            </button>
          </li>
        );
      })}
    </ol>
  );
}
