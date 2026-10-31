import { useState, type ChangeEvent } from 'react';
import { applyRestore, previewRestore } from '../../db/backup';
import type { RestorePreview } from '../../db/backup';
import type { BackupFile } from '../../domain/backupFormat';
import type { MergeSummary } from '../../domain/backupMerge';
import { useWriteError } from '../useWriteError';
import { WriteErrorAlert } from '../WriteErrorAlert';

const LABEL = 'Restore from backup…';
const IN_PROGRESS = 'Finish or discard your workout in progress before restoring.';
const UNCHANGED = 'Nothing on this phone was changed.';

type Refusal = Extract<RestorePreview, { kind: 'refused' }>['reason'];

/** What each refusal says, and whether the file's own detail goes beneath it. */
const REFUSALS: Record<Refusal, { message: string; showsDetail: boolean }> = {
  newer: {
    message:
      "This backup can't be restored. It was made by a newer version of the app. " +
      `Open the app while you're online so it updates, then try again. ${UNCHANGED}`,
    showsDetail: false,
  },
  'not-backup': {
    message: `This isn't a workout backup, or it's damaged. ${UNCHANGED}`,
    showsDetail: true,
  },
  damaged: {
    message: `This isn't a workout backup, or it's damaged. ${UNCHANGED}`,
    showsDetail: true,
  },
  'in-progress': { message: `${IN_PROGRESS} ${UNCHANGED}`, showsDetail: false },
};

/** What the control is showing, below the picker. */
type Phase =
  | { kind: 'idle' }
  /** Choosing the file failed; the write error says why. */
  | { kind: 'unreadable' }
  | { kind: 'refused'; reason: Refusal; detail: string }
  | { kind: 'nothing-to-add' }
  | { kind: 'confirm'; file: BackupFile; fileName: string; summary: MergeSummary }
  | { kind: 'done'; summary: MergeSummary };

const IDLE: Phase = { kind: 'idle' };

function phaseFor(preview: RestorePreview, fileName: string): Phase {
  if (preview.kind === 'refused') {
    return { kind: 'refused', reason: preview.reason, detail: preview.detail };
  }
  // The preview's own verdict, not the counts: a backup whose only news is a
  // goal, a weigh-in or a rotation swap has all-zero counts and still writes.
  if (preview.nothingToAdd) return { kind: 'nothing-to-add' };
  return { kind: 'confirm', file: preview.file, fileName, summary: preview.summary };
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** The summary as list items, each only when there is something to say. */
function summaryLines(s: MergeSummary): { key: string; text: string }[] {
  const lines: { key: string; text: string }[] = [];
  if (s.workouts > 0) {
    lines.push({ key: 'workouts', text: `${plural(s.workouts, 'workout')} (${plural(s.sets, 'set')})` });
  } else if (s.sets > 0) {
    lines.push({ key: 'sets', text: `${plural(s.sets, 'set')} in workouts already on this phone` });
  }
  if (s.routines > 0) lines.push({ key: 'routines', text: plural(s.routines, 'routine') });
  if (s.customExercises > 0) {
    lines.push({ key: 'customExercises', text: plural(s.customExercises, 'custom exercise') });
  }
  if (s.libraryEdits > 0) {
    lines.push({ key: 'libraryEdits', text: `your edits to ${plural(s.libraryEdits, 'library exercise')}` });
  }
  // Matched names are unique, so a name can key its own line.
  for (const name of s.matchedExercises) {
    lines.push({ key: `matched:${name}`, text: `${name}: history joins the copy already on this phone` });
  }
  if (s.rotationReplaced) {
    lines.push({ key: 'rotation', text: 'Your rotation from the backup replaces the one on this phone' });
  }
  return lines;
}

function Lines({ lines }: { lines: { key: string; text: string }[] }) {
  return (
    <ul>
      {lines.map((line) => <li key={line.key}>{line.text}</li>)}
    </ul>
  );
}

/**
 * Restores a backup file chosen from Files. Nothing is written until the user
 * has seen what the backup adds and tapped Restore.
 *
 * Router-free, and it has no querier: Settings tells it whether a workout is
 * in progress, and then there is nothing to choose or restore.
 */
export function RestoreControl({ inProgress }: { inProgress: boolean }) {
  const { error, run } = useWriteError();
  const [phase, setPhase] = useState<Phase>(IDLE);
  const [restoring, setRestoring] = useState(false);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // An input left holding the file fires no change when that same file is
    // chosen again, which is what a user does after Cancel.
    input.value = '';
    if (!file) return;

    setPhase(IDLE);
    const read = await run(async () => {
      setPhase(phaseFor(await previewRestore(await file.text()), file.name));
    });
    if (!read) setPhase({ kind: 'unreadable' });
  }

  async function restore(file: BackupFile) {
    setRestoring(true);
    // The list afterwards is what the restore reports adding, which is what
    // it planned again inside its transaction, not what the preview showed.
    await run(async () => setPhase({ kind: 'done', summary: await applyRestore(file) }));
    setRestoring(false);
  }

  // The confirmation and the result list the same things, from their own summary.
  const lines = 'summary' in phase ? summaryLines(phase.summary) : [];

  return (
    <>
      {inProgress ? (
        <>
          <button type="button" disabled>{LABEL}</button>
          <p>{IN_PROGRESS}</p>
        </>
      ) : (
        <label>
          {LABEL}
          <input
            type="file"
            accept=".json,application/json"
            disabled={restoring}
            onChange={(event) => void choose(event)}
          />
        </label>
      )}

      {phase.kind === 'refused' && (
        <div role="alert">
          <p>{REFUSALS[phase.reason].message}</p>
          {REFUSALS[phase.reason].showsDetail && <small>{phase.detail}</small>}
        </div>
      )}

      {phase.kind === 'nothing-to-add' && (
        <p role="status">Everything in this backup is already on this phone.</p>
      )}

      {phase.kind === 'confirm' && (
        <>
          <h3>Restore this backup?</h3>
          <p>{phase.fileName}</p>
          <p>Made {new Date(phase.file.exportedAt).toLocaleString()}</p>
          {lines.length > 0 && (
            <>
              <p>This adds:</p>
              <Lines lines={lines} />
            </>
          )}
          <p>
            Nothing already on this phone is removed. Settings switch to the backup's:{' '}
            {phase.summary.settings.unitPreference}, {phase.summary.settings.defaultRestSeconds} s rest,
            sound {phase.summary.settings.restAlertSound ? 'on' : 'off'}.
          </p>
          <button type="button" disabled={restoring} onClick={() => void restore(phase.file)}>
            Restore
          </button>
          <button type="button" disabled={restoring} onClick={() => setPhase(IDLE)}>
            Cancel
          </button>
        </>
      )}

      {phase.kind === 'done' && (
        <>
          <p role="status">Restored.</p>
          {lines.length > 0 && <Lines lines={lines} />}
        </>
      )}

      {/* A failure belongs to the phase it happened in. Cancel returns to idle,
          which hides it; the next choice's run clears the error itself. */}
      {phase.kind !== 'idle' && <WriteErrorAlert error={error} />}
    </>
  );
}
