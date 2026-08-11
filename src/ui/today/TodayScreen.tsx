import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getActiveCycle, getOrCreateActiveCycle, saveCycle } from '../../db/cycles';
import { getRoutine } from '../../db/routines';
import { listExercises } from '../../db/exercises';
import { nextRoutineId, skipNext, cyclePosition } from '../../domain/cycle';
import { useWriteError } from '../useWriteError';

export function TodayScreen() {
  const { error, run } = useWriteError();
  // One query rather than two chained ones. Splitting the cycle read from
  // the routine read makes the second query lag a render behind the first,
  // which flashes "no longer available" every time the rotation changes.
  // getActiveCycle, not getOrCreateActiveCycle: Dexie forbids opening a
  // readwrite transaction inside a liveQuery querier, and
  // getOrCreateActiveCycle always opens one to stay race-safe under
  // StrictMode's double-invoked effects. The bootstrap effect below creates
  // the cycle outside that context; db.cycles change tracking then re-runs
  // this query. Returns null until the cycle exists.
  const data = useLiveQuery(async () => {
    const cycle = await getActiveCycle();
    if (!cycle) return null;
    const upNextId = nextRoutineId(cycle);
    const routine = upNextId ? (await getRoutine(upNextId)) ?? null : null;
    return { cycle, routine };
  }, []);
  const exercises = useLiveQuery(() => listExercises({ includeArchived: true }), []);

  useEffect(() => {
    void run(() => getOrCreateActiveCycle());
  }, []);

  if (data === undefined || data === null || exercises === undefined) {
    return <p>Loading…</p>;
  }
  const { cycle, routine } = data;

  if (cycle.routineIds.length === 0) {
    return (
      <section>
        <h2>Today</h2>
        <p className="empty">
          Nothing in your rotation yet. <Link to="/cycle">Build one</Link> to see
          what is next.
        </p>
      </section>
    );
  }

  const position = cyclePosition(cycle);
  const nameById = new Map((exercises ?? []).map((e) => [e.id, e.name]));

  return (
    <section>
      <h2>Today</h2>

      <p className="cycle-position">
        {position} of {cycle.routineIds.length}
      </p>

      {routine === null ? (
        <p role="alert">That routine is no longer available.</p>
      ) : (
        <>
          <h3>{routine.name}</h3>
          {routine.items.length === 0 ? (
            <p className="empty">
              No exercises in this routine.{' '}
              <Link to={`/routines/${routine.id}`}>Add some</Link>.
            </p>
          ) : (
            <ol className="routine-preview">
              {routine.items.map((item) => (
                <li key={item.id}>{nameById.get(item.exerciseId) ?? 'Unknown exercise'}</li>
              ))}
            </ol>
          )}
        </>
      )}

      {error && <p role="alert">{error}</p>}

      <button type="button" onClick={() => run(() => saveCycle(skipNext(cycle)))}>
        Skip to next
      </button>
    </section>
  );
}
