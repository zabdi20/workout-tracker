import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getInProgressSession } from '../../db/sessions';
import { getRoutine } from '../../db/routines';
import { listExercises } from '../../db/exercises';
import { getSettings } from '../../db/settings';
import { lastPerformance, listSetsForSession } from '../../db/sets';
import { useWriteError } from '../useWriteError';

export function ActiveSessionScreen() {
  const { error, run } = useWriteError();

  // One querier rather than several chained ones: splitting the session read
  // from the routine read would make the second lag a render behind the
  // first, flashing an empty screen on every write.
  //
  // Every call in here is read-only. Dexie throws ReadOnlyError if a
  // liveQuery querier opens a readwrite transaction, so this screen creates
  // nothing — Today starts the session, and landing here without one
  // redirects rather than starting one.
  const data = useLiveQuery(async () => {
    const session = await getInProgressSession();
    if (!session) return null;

    const routine = session.routineId ? (await getRoutine(session.routineId)) ?? null : null;
    const [sets, exercises, settings] = await Promise.all([
      listSetsForSession(session.id),
      listExercises({ includeArchived: true }),
      getSettings(),
    ]);

    const exerciseIds = new Set([
      ...(routine?.items ?? []).map((i) => i.exerciseId),
      ...sets.map((s) => s.exerciseId),
    ]);
    const history = Object.fromEntries(
      await Promise.all(
        [...exerciseIds].map(async (id) =>
          [id, await lastPerformance(id, session.id)] as const,
        ),
      ),
    );

    return { session, routine, sets, exercises, settings, history };
  }, []);

  if (data === undefined) return <p>Loading…</p>;
  if (data === null) return <Navigate to="/" replace />;

  return (
    <section>
      <h2>{data.session.name}</h2>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
