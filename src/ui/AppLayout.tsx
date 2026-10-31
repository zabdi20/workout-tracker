import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { prepareLibrary } from '../db/seed';
import { STORAGE_FULL_MESSAGE, isQuotaError } from './useWriteError';
import { WriteErrorAlert } from './WriteErrorAlert';

const TABS = [
  { to: '/', label: 'Today', end: true },
  { to: '/history', label: 'History', end: false },
  { to: '/routines', label: 'Routines', end: false },
  { to: '/cycle', label: 'Rotation', end: false },
  { to: '/library', label: 'Library', end: false },
];

export function AppLayout() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Kept apart from `error`: a full disk is not "could not open the database",
  // and the user's way out of it is a backup, which the other failures lack.
  const [storageFull, setStorageFull] = useState(false);

  useEffect(() => {
    let cancelled = false;
    prepareLibrary()
      .then(() => { if (!cancelled) setReady(true); })
      .catch((e: unknown) => {
        // Failing loudly matters here: a silent failure would leave the app
        // looking functional while writing to nothing.
        if (cancelled) return;
        if (isQuotaError(e)) setStorageFull(true);
        else setError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="app">
      <header>
        <h1>Workout Tracker</h1>
        <Link to="/settings" aria-label="Settings">⚙︎</Link>
      </header>

      <main>
        {storageFull && <WriteErrorAlert error={STORAGE_FULL_MESSAGE} />}
        {error && (
          <p role="alert">
            Could not open the database: {error}. Training data cannot be saved.
          </p>
        )}
        {!error && !storageFull && !ready && <p>Preparing your exercise library…</p>}
        {ready && <Outlet />}
      </main>

      <nav aria-label="Sections">
        {TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end}>
            {tab.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
