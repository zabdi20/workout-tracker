import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { db, resetDbForTests } from '../../db/db';
import { getSettings } from '../../db/settings';
import { parseBackup } from '../../domain/backupFormat';
import { MIN, T, seedExercise, seedWorkout } from '../../testFixtures';
import { BackupButton } from './BackupButton';

beforeEach(async () => {
  await resetDbForTests();
});

function stubShare(impl: (data: ShareData) => Promise<void>) {
  const share = vi.fn(impl);
  Object.defineProperty(navigator, 'share', { value: share, configurable: true });
  Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
  return share;
}

afterEach(() => {
  delete (navigator as { share?: unknown }).share;
  delete (navigator as { canShare?: unknown }).canShare;
  delete (URL as { createObjectURL?: unknown }).createObjectURL;
  delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
  vi.restoreAllMocks();
});

const lastBackupAt = async () => (await getSettings()).lastBackupAt;

const FILE_NAME = /^workout-backup-\d{4}-\d{2}-\d{2}-\d{4}\.json$/;

/** When the backup in a shared file says it was made. */
async function exportedAtOf(file: File): Promise<number> {
  const parsed = parseBackup(await file.text(), Date.now());
  if (!parsed.ok) throw new Error(parsed.detail);
  return parsed.file.exportedAt;
}

/** Waits for a backup attempt to finish: the button is back and enabled. */
const settled = () =>
  waitFor(() => expect(screen.getByRole('button', { name: 'Back up now' })).toBeEnabled());

it('shares the backup as a JSON file and records it when the sheet reports success', async () => {
  const user = userEvent.setup();
  const ex = await seedExercise();
  await seedWorkout({ startedAt: T, sets: [{ exerciseId: ex.id, weight: 22.5, reps: 8, completedAt: T + MIN }] });
  const share = stubShare(async () => {});
  render(<BackupButton />);
  await user.click(screen.getByRole('button', { name: 'Back up now' }));
  expect(await screen.findByRole('status')).toHaveTextContent(/^Backup saved\.$/);
  expect(share).toHaveBeenCalledTimes(1);
  const file = share.mock.calls[0][0].files![0];
  expect(file.name).toMatch(FILE_NAME);
  expect(file.type).toBe('application/json');
  const parsed = parseBackup(await file.text(), Date.now());
  if (!parsed.ok) throw new Error(parsed.detail);
  expect(parsed.file.tables.sets).toEqual(await db.sets.toArray());
  expect(await lastBackupAt()).toBe(parsed.file.exportedAt);
});

it('records nothing and says nothing when the user backs out', async () => {
  // Rejects: recording before the share settles, and a message for a share
  // the user cancelled.
  const user = userEvent.setup();
  const share = stubShare(async () => { throw new DOMException('', 'AbortError'); });
  render(<BackupButton />);
  await user.click(screen.getByRole('button', { name: 'Back up now' }));
  await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
  await settled();
  expect(await lastBackupAt()).toBeUndefined();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('status')).toBeNull();
});

it('offers a second tap when iOS says the tap expired', async () => {
  // Rejects: a button that stays "Back up now" after the expiry, recording a
  // file that was never saved, a second tap that builds another File, and a
  // "Save backup file" button that outlives the save.
  const user = userEvent.setup();
  let calls = 0;
  const share = stubShare(async () => {
    if (calls++ === 0) throw new DOMException('', 'NotAllowedError');
  });
  render(<BackupButton />);
  await user.click(screen.getByRole('button', { name: 'Back up now' }));
  await user.click(await screen.findByRole('button', { name: 'Save backup file' }));
  expect(await screen.findByRole('status')).toHaveTextContent(/^Backup saved\.$/);
  expect(share).toHaveBeenCalledTimes(2);
  const first = share.mock.calls[0][0].files![0];
  expect(share.mock.calls[1][0].files![0]).toBe(first);
  expect(await lastBackupAt()).toBe(await exportedAtOf(first));
  // Saved: the file is done with, so the button starts over.
  expect(screen.getByRole('button', { name: 'Back up now' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Save backup file' })).toBeNull();
});

it('records nothing between the expired tap and the second one', async () => {
  // Rejects: recording on the rejection, and leaving "Back up now" beside
  // "Save backup file".
  const user = userEvent.setup();
  const share = stubShare(async () => { throw new DOMException('', 'NotAllowedError'); });
  render(<BackupButton />);
  await user.click(screen.getByRole('button', { name: 'Back up now' }));
  expect(await screen.findByRole('button', { name: 'Save backup file' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Back up now' })).toBeNull();
  expect(share).toHaveBeenCalledTimes(1);
  expect(await lastBackupAt()).toBeUndefined();
  expect(screen.queryByRole('status')).toBeNull();
});

it('shows any other share failure', async () => {
  // Rejects: swallowing an error that is neither a back-out nor an expiry, and
  // recording after it.
  const user = userEvent.setup();
  stubShare(async () => { throw new TypeError('Share failed'); });
  render(<BackupButton />);
  await user.click(screen.getByRole('button', { name: 'Back up now' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/^Share failed$/);
  await settled();
  expect(await lastBackupAt()).toBeUndefined();
  expect(screen.queryByRole('status')).toBeNull();
});

it('shows a failure to build the backup, and shares nothing', async () => {
  // Rejects: sharing a file that was never built, and an unhandled rejection.
  const user = userEvent.setup();
  const share = stubShare(async () => {});
  vi.spyOn(db.sets, 'toArray').mockRejectedValue(new Error('read failed'));
  render(<BackupButton />);
  await user.click(screen.getByRole('button', { name: 'Back up now' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/^read failed$/);
  await settled();
  expect(share).not.toHaveBeenCalled();
  expect(await lastBackupAt()).toBeUndefined();
});

it('downloads when the browser cannot share files', async () => {
  // Rejects: recording only after a share (a download has no completion
  // signal, so it is recorded at the click), and revoking the link before the
  // browser has read it.
  const user = userEvent.setup();
  const create = vi.fn((_blob: Blob) => 'blob:x');
  const revoke = vi.fn((_url: string) => {});
  Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: revoke, configurable: true });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const timers = vi.spyOn(globalThis, 'setTimeout');
  render(<BackupButton />);
  await user.click(screen.getByRole('button', { name: 'Back up now' }));
  expect(await screen.findByRole('status')).toHaveTextContent(/^Backup saved\.$/);
  expect(click).toHaveBeenCalledTimes(1);
  const link = click.mock.contexts[0] as HTMLAnchorElement;
  expect(link.download).toMatch(FILE_NAME);
  expect(link.href).toBe('blob:x');
  expect((create.mock.calls[0][0] as File).name).toBe(link.download);
  expect(await lastBackupAt()).toBe(await exportedAtOf(create.mock.calls[0][0] as File));
  // Revoked a minute later, not at the click.
  expect(revoke).not.toHaveBeenCalled();
  const revokeLater = timers.mock.calls.find(([, delay]) => delay === 60_000);
  (revokeLater![0] as () => void)();
  expect(revoke).toHaveBeenCalledWith('blob:x');
});

it('saves a flawed snapshot but warns and leaves the reminder', async () => {
  // Rejects: refusing to save a backup with a problem (a backup with one bad
  // row beats none), and recording it, which would reset the reminder for a
  // file that cannot be restored.
  const user = userEvent.setup();
  await seedWorkout({ name: 'Moved Push', startedAt: Date.UTC(1999, 5, 1, 17) });
  const share = stubShare(async () => {});
  render(<BackupButton />);
  await user.click(screen.getByRole('button', { name: 'Back up now' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('This backup saved, but it has a problem that would stop it restoring:');
  expect(alert).toHaveTextContent('Moved Push');
  await settled();
  expect(share).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('status')).toBeNull();
  expect(await lastBackupAt()).toBeUndefined();
});

it('says so when the backup saved but the date could not be recorded', async () => {
  // Rejects: reporting success when the reminder will not reset.
  const user = userEvent.setup();
  stubShare(async () => {});
  vi.spyOn(db.settings, 'put').mockRejectedValue(new Error('disk full'));
  render(<BackupButton />);
  await user.click(screen.getByRole('button', { name: 'Back up now' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    /^Backup saved, but the app couldn't record the date, so the reminder won't reset\.$/,
  );
  await settled();
  expect(screen.queryByRole('status')).toBeNull();
});

it('cannot start a second backup while one is in flight', async () => {
  // Rejects: a button that stays enabled while a backup is under way.
  const user = userEvent.setup();
  let finish!: () => void;
  const share = stubShare(() => new Promise<void>((resolve) => { finish = resolve; }));
  render(<BackupButton />);
  await user.click(screen.getByRole('button', { name: 'Back up now' }));
  await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: 'Back up now' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Back up now' }));
  expect(share).toHaveBeenCalledTimes(1);
  finish();
  expect(await screen.findByRole('status')).toHaveTextContent(/^Backup saved\.$/);
  expect(share).toHaveBeenCalledTimes(1);
});
