import { useEffect, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getInProgressSession } from '../../db/sessions';
import { getSettings, updateSettings } from '../../db/settings';
import type { WeightUnit } from '../../db/types';
import { daysAgoLabel } from '../../domain/backupReminder';
import { BackupButton } from '../backup/BackupButton';
import { useWriteError } from '../useWriteError';
import { WriteErrorAlert } from '../WriteErrorAlert';
import { RestoreControl } from './RestoreControl';

const UNITS: readonly WeightUnit[] = ['lb', 'kg'];

const REST_PROBLEM = 'Rest must be a whole number of seconds, at least 1.';

type Protection = 'Yes' | 'No' | 'Unknown';

export function SettingsScreen() {
  // The only querier. `data.inProgress` is for the restore control, which
  // must refuse to run while a workout is open.
  const data = useLiveQuery(
    async () => ({
      settings: await getSettings(),
      inProgress: await getInProgressSession(),
    }),
    [],
  );
  const { error, run } = useWriteError();

  // The rest field shows what the user has typed until it is saved, then the
  // stored value again. Deriving the displayed value this way means a failed
  // write cannot snap the field back to the old number.
  const [restDraft, setRestDraft] = useState<string | null>(null);
  const [restProblem, setRestProblem] = useState<string | null>(null);

  // Not a Dexie read, so it cannot live in the querier.
  const [protection, setProtection] = useState<Protection>('Unknown');
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // Missing on browsers without a storage manager: stays Unknown.
        if (!navigator.storage?.persisted) return;
        const persisted = await navigator.storage.persisted();
        if (!cancelled) setProtection(persisted ? 'Yes' : 'No');
      } catch {
        // A refusal is also "Unknown"; there is nothing for the user to do.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (data === undefined) return <p>Loading…</p>;

  const { settings } = data;
  const restValue = restDraft ?? String(settings.defaultRestSeconds);

  async function commitRest() {
    if (restDraft === null) return;
    const typed = restDraft;
    const seconds = /^\d+$/.test(typed) ? Number(typed) : NaN;
    // Digits alone aren't enough. Past 308 of them the number is Infinity,
    // which JSON writes as null, and a stored null would make every later
    // backup fail its own check; short of that it is still not exact.
    if (!Number.isSafeInteger(seconds) || seconds < 1) {
      setRestProblem(REST_PROBLEM);
      return;
    }
    setRestProblem(null);
    // Cleared only once the write has landed, and only if nothing was typed
    // while it ran: on failure the user keeps the number to retry with.
    if (await run(() => updateSettings({ defaultRestSeconds: seconds }))) {
      setRestDraft((current) => (current === typed ? null : current));
    }
  }

  function handleRestSubmit(event: FormEvent) {
    event.preventDefault();
    void commitRest();
  }

  const lastBackupAt = settings.lastBackupAt;

  return (
    <section>
      <h2>Settings</h2>
      <WriteErrorAlert error={error} />

      <h3>Weights</h3>
      <fieldset>
        <legend>Unit for exercises you haven't logged yet</legend>
        {UNITS.map((unitPreference) => (
          <label key={unitPreference}>
            <input
              type="radio"
              name="unit"
              checked={settings.unitPreference === unitPreference}
              onChange={() => void run(() => updateSettings({ unitPreference }))}
            />
            {unitPreference}
          </label>
        ))}
      </fieldset>

      <h3>Rest</h3>
      <form noValidate onSubmit={handleRestSubmit}>
        <label>
          Default rest between sets (seconds)
          <input
            type="number"
            inputMode="numeric"
            value={restValue}
            onChange={(e) => setRestDraft(e.target.value)}
            onBlur={() => void commitRest()}
          />
        </label>
        {restProblem && <p role="alert">{restProblem}</p>}
      </form>
      <p>A routine's own rest time still wins.</p>
      <label>
        <input
          type="checkbox"
          checked={settings.restAlertSound}
          onChange={(e) => {
            const restAlertSound = e.target.checked;
            void run(() => updateSettings({ restAlertSound }));
          }}
        />
        Sound when rest ends
      </label>

      <h3>Backup</h3>
      {lastBackupAt === undefined ? (
        <p>Last backup: Never</p>
      ) : (
        <p>
          Last backup: {new Date(lastBackupAt).toLocaleDateString()} · {daysAgoLabel(lastBackupAt, Date.now())}
        </p>
      )}
      <BackupButton />
      <RestoreControl inProgress={!!data.inProgress} />

      <h3>Storage</h3>
      <p>Protected from iOS clean-up: {protection}</p>
      <p>iOS may clear this app's data when the phone runs low on space. Your backups are the safety net.</p>
    </section>
  );
}
