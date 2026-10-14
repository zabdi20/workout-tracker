import { useState } from 'react';
import type { FormEvent } from 'react';
import { parseSetFields } from '../../domain/measurement';
import type { SetFieldSpec } from '../../domain/measurement';
import type { LoggedSet, SetType } from '../../db/types';

interface SetFieldsFormProps {
  /** Names the form for assistive tech and tests, e.g. "Edit Back Squat set 2". */
  label: string;
  fields: SetFieldSpec[];
  /** The set whose values fill the fields. For an edit it is the set itself;
   *  for an add it is the exercise's last set. Read once, at mount. */
  seed: LoggedSet;
  /** Whether the warm-up box starts ticked. Read once, at mount. */
  initialWarmup: boolean;
  /** Writes the parsed values. Resolves true only when the write landed. */
  onSave: (
    values: ReturnType<typeof parseSetFields>,
    setType: SetType,
  ) => Promise<boolean>;
  /** Called on Cancel, and after a save that landed. */
  onClose: () => void;
}

/**
 * The fields and warm-up flag of one set, with Save and Cancel. Shared by the
 * edit and add surfaces of a past workout, so the rules that matter live once.
 *
 * The draft strings are this form's own state, seeded at mount. The screen
 * above re-renders on every write to the database; a draft derived from props
 * would be overwritten mid-keystroke by the next re-render.
 *
 * The form closes only when `onSave` resolves true. A failed write leaves it
 * open with everything the user typed, so they can retry rather than retype.
 */
export function SetFieldsForm({
  label,
  fields,
  seed,
  initialWarmup,
  onSave,
  onClose,
}: SetFieldsFormProps) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map((f) => [f.property, seed[f.property] === undefined ? '' : String(seed[f.property])]),
    ),
  );
  const [isWarmup, setIsWarmup] = useState(initialWarmup);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;

    // Same parse as logging a set in the active workout: blank and non-numeric
    // fields are left out, and nothing more is checked.
    const values = parseSetFields(fields, (property) => draft[property] ?? '');

    // Nothing parsed: there is nothing to write, and the form stays open.
    // The same no-op the active workout makes for a row nobody filled in.
    if (Object.keys(values).length === 0) return;

    setBusy(true);
    const wrote = await onSave(values, isWarmup ? 'warmup' : 'working');
    if (wrote) onClose();
    // Cleared only on failure: on success the form has just unmounted, and on
    // failure a Save that stayed disabled would trade a recoverable error for
    // a form the user cannot do anything with.
    else setBusy(false);
  }

  return (
    // noValidate: a number input's default step of 1 would make the browser
    // refuse 22.5 lb or 102.5 kg on submit, a check the active workout, which
    // has no form, never makes.
    <form aria-label={label} noValidate onSubmit={(e) => void submit(e)}>
      {fields.map((field) => (
        <label key={field.property}>
          {field.label}
          {field.unitBearing ? ` (${seed.unit})` : ''}
          <input
            type="number"
            aria-label={field.label}
            value={draft[field.property] ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, [field.property]: e.target.value }))}
          />
        </label>
      ))}

      <label>
        Warm-up
        <input
          type="checkbox"
          checked={isWarmup}
          onChange={(e) => setIsWarmup(e.target.checked)}
        />
      </label>

      <button type="submit" disabled={busy}>Save</button>
      <button type="button" onClick={onClose}>Cancel</button>
    </form>
  );
}
