/**
 * Asks the browser to exempt our IndexedDB data from eviction.
 * iOS reclaims web storage more aggressively than native app storage, so this
 * is a meaningful defence for training history. It is best-effort: a false
 * return is not an error, it just means backups matter more.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
