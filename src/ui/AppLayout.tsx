import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { prepareLibrary } from '../db/seed';

const TABS = [
  { to: '/', label: 'Today', end: true },
  { to: '/routines', label: 'Routines', end: false },
  { to: '/cycle', label: 'Rotation', end: false },
  { to: '/library', label: 'Library', end: false },
];

export function AppLayout() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    prepareLibrary()
      .then(() => { if (!cancelled) setReady(true); })
      .catch((e: unknown) => {
        // Failing loudly matters here: a silent failure would leave the app
        // looking functional while writing to nothing.
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="app">
      <header>
        <h1>Workout Tracker</h1>
      </header>

      <main>
        {error && (
          <p role="alert">
            Could not open the database: {error}. Training data cannot be saved.
          </p>
        )}
        {!error && !ready && <p>Preparing your exercise library…</p>}
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
