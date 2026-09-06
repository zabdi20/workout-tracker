import type { SetFieldSpec } from '../../domain/measurement';
import type { PlannedSet } from '../../domain/setPlan';

interface PlannedSetRowProps {
  row: PlannedSet;
  fields: SetFieldSpec[];
  /** The string to show for one field: the user's draft when they have typed
   *  one, otherwise the prefilled value. Bound to this row by the caller. */
  valueFor: (property: SetFieldSpec['property']) => string;
  onFieldChange: (property: SetFieldSpec['property'], value: string) => void;
  isWarmup: boolean;
  onWarmupChange: (checked: boolean) => void;
  /** True while this row's own write is in flight. */
  busy: boolean;
  onConfirm: () => void;
}

/**
 * One unconfirmed row. Nothing here reaches the sets table until the confirm
 * button is tapped — planned rows are UI state, which is what keeps PR
 * detection, volume and the backup format from ever having to filter out sets
 * that were not performed.
 */
export function PlannedSetRow({
  row,
  fields,
  valueFor,
  onFieldChange,
  isWarmup,
  onWarmupChange,
  busy,
  onConfirm,
}: PlannedSetRowProps) {
  return (
    <li>
      {fields.map((field) => (
        <label key={field.property}>
          {field.label}
          {field.unitBearing ? ` (${row.unit})` : ''}
          <input
            type="number"
            aria-label={`${field.label} for set ${row.position}`}
            value={valueFor(field.property)}
            onChange={(e) => onFieldChange(field.property, e.target.value)}
          />
        </label>
      ))}

      <label>
        Warm-up
        <input
          type="checkbox"
          aria-label={`Mark set ${row.position} as a warm-up`}
          checked={isWarmup}
          onChange={(e) => onWarmupChange(e.target.checked)}
        />
      </label>

      <button
        type="button"
        // Disabled while its own write is in flight. Two fast taps would
        // otherwise log the set twice; logSet's transactional order
        // assignment keeps them distinct, but the second set is still one the
        // user did not perform.
        disabled={busy}
        onClick={onConfirm}
      >
        Log set {row.position}
      </button>
    </li>
  );
}
