import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { listCompletedSessions } from '../../db/sessions';
import { listAllSets } from '../../db/sets';
import { listExercises } from '../../db/exercises';
import { detectAllPrs } from '../../domain/records';
import { formatWorkoutDuration } from './format';
import type { LoggedSet } from '../../db/types';

function plural(n: number, singular: string, pluralForm: string): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

export function HistoryScreen() {
  // One querier, read-only throughout. Resolves to `undefined` while loading.
  const data = useLiveQuery(async () => {
    const [sessions, sets, exercises] = await Promise.all([
      listCompletedSessions(),
      listAllSets(),
      // Archived exercises included: their old sets still count as sets and
      // can still have been records.
      listExercises({ includeArchived: true }),
    ]);
    // Run once over every set. A PR is judged against everything before it,
    // so per-workout detection would call the first set of each exercise a
    // record.
    return { sessions, sets, prs: detectAllPrs(sets, exercises) };
  }, []);

  if (data === undefined) return <p>Loading…</p>;

  const { sessions, sets, prs } = data;

  const setsBySession = new Map<string, LoggedSet[]>();
  for (const s of sets) {
    const group = setsBySession.get(s.sessionId);
    if (group) group.push(s);
    else setsBySession.set(s.sessionId, [s]);
  }

  return (
    <section>
      <h2>History</h2>

      {sessions.length === 0 && <p className="empty">No finished workouts yet.</p>}

      <ol>
        {sessions.map((session) => {
          const own = setsBySession.get(session.id) ?? [];
          const working = own.filter((s) => s.setType !== 'warmup').length;
          // Sets that earned at least one record type, not badges: a set that
          // earned three kinds is one PR here.
          const prSets = own.filter((s) => prs.has(s.id)).length;
          return (
            <li key={session.id}>
              <Link to={`/history/${session.id}`}>{session.name}</Link>{' '}
              <span>
                {`${new Date(session.startedAt).toLocaleString()} · ${formatWorkoutDuration(session.startedAt, session.endedAt)} · ${plural(working, 'set', 'sets')}`}
                {prSets > 0 && ` · ${plural(prSets, 'PR', 'PRs')}`}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
