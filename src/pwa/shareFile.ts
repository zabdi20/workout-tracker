/**
 * Handing a file to the user: the share sheet where the browser has one, a
 * download link where it doesn't.
 *
 * The share sheet is the path proven on the iPhone, in the home-screen app:
 * its Save to Files puts the file in iCloud Drive, and `share()` resolving
 * means the user saved it (docs/superpowers/spikes/2026-10-20-backup-file-transfer.md).
 */

/** Whether the browser can share this file at all. A desktop browser usually
 *  can't, and neither can one that lacks `navigator.canShare`. */
export function canShareFiles(file: File): boolean {
  return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
}

const errorName = (e: unknown): unknown =>
  typeof e === 'object' && e !== null && 'name' in e ? e.name : undefined;

/**
 * Opens the share sheet with the file.
 *
 * - `'saved'`: the sheet reported success. The user picked somewhere and saved.
 * - `'cancelled'`: the user backed out (`AbortError`). Nothing was saved, and
 *   it is not an error.
 * - `'expired'`: the browser refused to open the sheet (`NotAllowedError`).
 *   iOS requires `share()` to run during the user's tap, and a tap that waited
 *   on the file being built can run out. The caller offers a second tap.
 *
 * Anything else is rethrown for the caller to show.
 */
export async function shareFile(file: File): Promise<'saved' | 'cancelled' | 'expired'> {
  try {
    await navigator.share({ files: [file] });
    return 'saved';
  } catch (e: unknown) {
    const name = errorName(e);
    if (name === 'AbortError') return 'cancelled';
    if (name === 'NotAllowedError') return 'expired';
    throw e;
  }
}

/** Saves the file through a download link. There is no signal that the user
 *  kept it. */
export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  // In the document for the click: some browsers ignore a link that isn't.
  document.body.append(link);
  link.click();
  link.remove();
  // Not at once: the browser reads the blob after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
