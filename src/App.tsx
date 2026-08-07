import { useEffect, useState } from 'react';
import { seedExercisesIfEmpty } from './db/seed';
import { LibraryScreen } from './ui/library/LibraryScreen';

export function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    seedExercisesIfEmpty()
      .then(() => setReady(true))
      .catch((e: unknown) => {
        // Failing loudly matters here: a silent failure would leave the app
        // looking functional while writing to nothing.
        setError(e instanceof Error ? e.message : String(e));
      });
  }, []);

  return (
    <main>
      <h1>Workout Tracker</h1>
      {error && (
        <p role="alert">
          Could not open the database: {error}. Training data cannot be saved.
        </p>
      )}
      {!error && !ready && <p>Preparing your exercise library…</p>}
      {ready && <LibraryScreen />}
    </main>
  );
}
