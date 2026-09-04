import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { getInProgressSession } from '../../db/sessions';
import { getRoutine } from '../../db/routines';
import { listExercises } from '../../db/exercises';
import { getSettings } from '../../db/settings';
import { deleteSet, lastPerformance, listSetsForSession, logSet } from '../../db/sets';
import { useWriteError } from '../useWriteError';
import { formatDuration, formatSet, measurementFields } from '../../domain/measurement';
import { planSets } from '../../domain/setPlan';
import type { LoggedSet, RoutineItem } from '../../db/types';

export function ActiveSessionScreen() {
  const { error, run } = useWriteError();

  // Identity-based, not positional: the exercise list grows when one is added
  // mid-session, and an index would silently point at a different movement.
  // The same lesson the rotation pointer taught.
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // Per-exercise signed count of rows the user added or removed.
  const [adjust, setAdjust] = useState<Record<string, number>>({});
  // Edits to unconfirmed rows, keyed `${exerciseId}:${position}:${property}`.
  // Overlaid on the derived prefill, the same way RoutineEditor overlays
  // draftName — which avoids a seeding effect that could land after the user
  // has started typing and discard their input.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [warmup, setWarmup] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);

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

  const { session, routine, sets, exercises, settings, history } = data;
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));
  const itemByExerciseId = new Map<string, RoutineItem>(
    (routine?.items ?? []).map((i) => [i.exerciseId, i]),
  );

  // Derived, never stored: the routine's items in order, then anything with
  // logged sets that is not in the routine. That is what makes Add exercise
  // free — it writes nothing.
  const routineIds = (routine?.items ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((i) => i.exerciseId);
  const extraIds = [...new Set(sets.map((s) => s.exerciseId))].filter(
    (id) => !routineIds.includes(id),
  );
  const exerciseIds = [...routineIds, ...extraIds];

  const focused = focusedId && exerciseIds.includes(focusedId) ? focusedId : exerciseIds[0];

  if (exerciseIds.length === 0) {
    return (
      <section>
        <h2>{session.name}</h2>
        {error && <p role="alert">{error}</p>}
        <p className="empty">This routine has no exercises.</p>
      </section>
    );
  }

  const exercise = exerciseById.get(focused);
  if (!exercise) {
    // Unreachable in practice: exercises are archived rather than deleted,
    // and the querier above loads archived ones. Guarding here once keeps
    // every use below non-null instead of scattering `!` assertions.
    return (
      <section>
        <h2>{session.name}</h2>
        <p role="alert">That exercise is no longer in the library.</p>
      </section>
    );
  }

  const item = itemByExerciseId.get(focused);
  const logged = sets.filter((s) => s.exerciseId === focused);
  const last = history[focused] ?? [];
  const fields = measurementFields(exercise.measurementType);
  const restSeconds = item?.restSeconds ?? settings.defaultRestSeconds;

  const planned = planSets({
    targetSets: item?.targetSets,
    lastPerformance: last,
    logged,
    defaultUnit: settings.unitPreference,
    adjust: adjust[focused] ?? 0,
  });

  function draftKey(position: number, property: string) {
    return `${focused}:${position}:${property}`;
  }

  function valueFor(row: { position: number }, property: string, derived?: number) {
    const key = draftKey(row.position, property);
    if (key in drafts) return drafts[key];
    return derived === undefined ? '' : String(derived);
  }

  // An arrow function assigned to a const, not a function declaration: only
  // that form keeps TypeScript's narrowing of `exercise` (guarded above) in
  // scope here. A `function confirmSet(...)` declaration is hoisted and
  // loses the narrowing, since the checker can't rule out it being called
  // from somewhere before the guard ran.
  const confirmSet = async (row: (typeof planned)[number]) => {
    const key = `${focused}:${row.position}`;
    if (busy === key) return;
    setBusy(key);

    const values: Partial<LoggedSet> = {};
    for (const field of fields) {
      const raw = valueFor(row, field.property, row[field.property]);
      const parsed = raw.trim() === '' ? undefined : Number(raw);
      // Cast deliberately: field.property is a union of four keys, and
      // TypeScript narrows a union-keyed write to their intersection, which
      // is `never`. The runtime shape is correct by construction.
      if (parsed !== undefined && !Number.isNaN(parsed)) {
        (values as Record<string, number>)[field.property] = parsed;
      }
    }

    await run(async () => {
      await logSet({
        sessionId: session.id,
        exerciseId: exercise.id,
        setType: warmup[key] ? 'warmup' : 'working',
        unit: row.unit,
        ...values,
      });
    });

    setDrafts((d) => {
      const next = { ...d };
      for (const field of fields) delete next[draftKey(row.position, field.property)];
      return next;
    });
    setWarmup((w) => {
      const { [key]: _cleared, ...rest } = w;
      return rest;
    });
    setBusy(null);
  };

  return (
    <section>
      <h2>{session.name}</h2>
      {error && <p role="alert">{error}</p>}

      <nav aria-label="Exercises in this session">
        {exerciseIds.map((id) => (
          <button
            key={id}
            type="button"
            aria-current={id === focused}
            onClick={() => setFocusedId(id)}
          >
            {exerciseById.get(id)?.name ?? 'Unknown exercise'}
          </button>
        ))}
      </nav>

      <h3>{exercise.name}</h3>
      {exercise.isArchived && <p>This exercise is archived.</p>}

      {item?.targetSets !== undefined && (
        <p className="prescription">
          {item.targetSets} &times;{' '}
          {item.targetRepMin !== undefined && item.targetRepMax !== undefined
            ? `${item.targetRepMin}–${item.targetRepMax}`
            : (item.targetRepMin ?? item.targetRepMax ?? '')}
        </p>
      )}
      <p className="rest">Rest {formatDuration(restSeconds)}</p>

      <p className="last-time">
        {last.length === 0
          ? 'No history for this exercise yet.'
          : `Last time: ${last
              .map((s) => formatSet(s, exercise.measurementType))
              .join(' · ')}`}
      </p>

      <ol className="logged-sets">
        {logged.map((set, index) => (
          <li key={set.id}>
            <span>
              {index + 1}. {formatSet(set, exercise.measurementType)}
              {set.setType === 'warmup' && ' (warm-up)'}
            </span>
            <button
              type="button"
              aria-label={`Remove logged set ${index + 1}`}
              onClick={() => run(() => deleteSet(set.id))}
            >
              Remove
            </button>
          </li>
        ))}
      </ol>

      <ol className="planned-sets">
        {planned.map((row) => (
          <li key={row.position}>
            {fields.map((field) => (
              <label key={field.property}>
                {field.label}
                {field.unitBearing ? ` (${row.unit})` : ''}
                <input
                  type="number"
                  aria-label={`${field.label} for set ${row.position}`}
                  value={valueFor(row, field.property, row[field.property])}
                  onChange={(e) =>
                    setDrafts((d) => ({
                      ...d,
                      [draftKey(row.position, field.property)]: e.target.value,
                    }))
                  }
                />
              </label>
            ))}

            <label>
              Warm-up
              <input
                type="checkbox"
                aria-label={`Mark set ${row.position} as a warm-up`}
                checked={warmup[`${focused}:${row.position}`] ?? false}
                onChange={(e) =>
                  setWarmup((w) => ({ ...w, [`${focused}:${row.position}`]: e.target.checked }))
                }
              />
            </label>

            <button
              type="button"
              // Disabled while its own write is in flight. Two fast taps
              // would otherwise log the set twice; logSet's transactional
              // order assignment keeps them distinct, but the second set is
              // still one the user did not perform.
              disabled={busy === `${focused}:${row.position}`}
              onClick={() => void confirmSet(row)}
            >
              Log set {row.position}
            </button>

            <button
              type="button"
              aria-label={`Remove planned set ${row.position}`}
              onClick={() => setAdjust((a) => ({ ...a, [focused]: (a[focused] ?? 0) - 1 }))}
            >
              Remove
            </button>
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={() => setAdjust((a) => ({ ...a, [focused]: (a[focused] ?? 0) + 1 }))}
      >
        Add set
      </button>
    </section>
  );
}
