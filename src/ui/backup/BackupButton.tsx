import { useState } from 'react';
import { createBackup, recordBackup } from '../../db/backup';
import { canShareFiles, downloadFile, shareFile } from '../../pwa/shareFile';
import { useWriteError } from '../useWriteError';

/** A backup that is built and ready to save. */
interface Built {
  file: File;
  exportedAt: number;
  /** What would stop the backup restoring, or null. See PreparedBackup. */
  problem: string | null;
}

interface Notice {
  role: 'status' | 'alert';
  text: string;
}

async function build(): Promise<Built> {
  const { file, text, name, problem } = await createBackup();
  return {
    file: new File([text], name, { type: 'application/json' }),
    exportedAt: file.exportedAt,
    problem,
  };
}

/**
 * Gives the file to the user. A download has no completion signal, so it
 * counts as saved at the click.
 */
async function send(file: File): Promise<'saved' | 'cancelled' | 'expired'> {
  if (!canShareFiles(file)) {
    downloadFile(file);
    return 'saved';
  }
  return shareFile(file);
}

/**
 * Backs up the database through the share sheet, and records the backup only
 * once the sheet reports that the user saved it.
 *
 * iOS opens the sheet only from the user's tap, and building the file is
 * asynchronous, so the tap can run out first. Then the file stays built and
 * the button becomes "Save backup file": a second tap shares that same file
 * without building anything, so `share()` runs inside the tap.
 *
 * Settings, Today's reminder and the storage-full message all render this, so
 * it takes no props and needs no router. It shows its own failures; it does
 * not render WriteErrorAlert, which renders this.
 */
export function BackupButton() {
  const { run } = useWriteError();
  const [busy, setBusy] = useState(false);
  // Set only while a tap has expired: the file, built and waiting for another.
  const [waiting, setWaiting] = useState<Built | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  /** Says what a saved backup means for the reminder. */
  async function report({ exportedAt, problem }: Built): Promise<Notice> {
    // A flawed backup is saved, but it must not reset the reminder: the user
    // would believe they have a backup they could restore.
    if (problem !== null) {
      return {
        role: 'alert',
        text: `This backup saved, but it has a problem that would stop it restoring: ${problem}`,
      };
    }
    if (!(await run(() => recordBackup(exportedAt)))) {
      return {
        role: 'alert',
        text: "Backup saved, but the app couldn't record the date, so the reminder won't reset.",
      };
    }
    return { role: 'status', text: 'Backup saved.' };
  }

  /** `ready` is a file built earlier. It goes straight to the sheet, with no
   *  await first, because the tap it runs in is the one that must not run out. */
  async function go(ready: Built | null) {
    setBusy(true);
    setNotice(null);
    try {
      const built = ready ?? (await build());
      const outcome = await send(built.file);
      setWaiting(outcome === 'expired' ? built : null);
      if (outcome === 'saved') setNotice(await report(built));
    } catch (e: unknown) {
      setWaiting(null);
      setNotice({ role: 'alert', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {waiting ? (
        <button type="button" disabled={busy} onClick={() => void go(waiting)}>
          Save backup file
        </button>
      ) : (
        <button type="button" disabled={busy} onClick={() => void go(null)}>
          Back up now
        </button>
      )}
      {notice && <p role={notice.role}>{notice.text}</p>}
    </>
  );
}
