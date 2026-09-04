import { db, resetDbForTests } from './db';
import { archiveRoutine, createRoutine } from './routines';
import { discardSession, finishSession, getInProgressSession, getSession, startSession } from './sessions';
import { getOrCreateActiveCycle, saveCycle, getActiveCycle } from './cycles';
import { logSet } from './sets';

beforeEach(async () => {
  await resetDbForTests();
});

describe('getInProgressSession', () => {
  it('returns undefined when nothing is in progress', async () => {
    expect(await getInProgressSession()).toBeUndefined();
  });

  it('returns the session once one is started', async () => {
    const routine = await createRoutine('Push A');
    const started = await startSession(routine);
    expect((await getInProgressSession())?.id).toBe(started.id);
  });
});

describe('startSession', () => {
  it('snapshots the routine name so a later rename does not rewrite history', async () => {
    const routine = await createRoutine('Push A');
    const session = await startSession(routine);

    expect(session.name).toBe('Push A');
    expect(session.routineId).toBe(routine.id);
    expect(session.status).toBe('in_progress');
    expect(session.endedAt).toBeUndefined();
  });

  it('creates exactly one session when called concurrently', async () => {
    // StrictMode double-invokes effects, and a double-tap on Start is the
    // same race: both calls can observe an empty table before either writes.
    const routine = await createRoutine('Push A');
    await Promise.all([startSession(routine), startSession(routine)]);
    expect(await db.sessions.count()).toBe(1);
  });

  it('is idempotent for the same routine', async () => {
    const routine = await createRoutine('Push A');
    const first = await startSession(routine);
    const second = await startSession(routine);
    expect(second.id).toBe(first.id);
  });

  it('refuses to start a second session for a different routine', async () => {
    const push = await createRoutine('Push A');
    const pull = await createRoutine('Pull A');
    await startSession(push);

    await expect(startSession(pull)).rejects.toThrow(/already in progress/i);
    expect(await db.sessions.count()).toBe(1);
  });
});

describe('finishSession', () => {
  it('completes the session and stamps endedAt', async () => {
    const routine = await createRoutine('Push A');
    const session = await startSession(routine);

    await finishSession(session.id);

    const done = await getSession(session.id);
    expect(done?.status).toBe('completed');
    expect(done?.endedAt).toBeGreaterThan(0);
    expect(await getInProgressSession()).toBeUndefined();
  });

  it('advances the rotation past the routine that was trained', async () => {
    const push = await createRoutine('Push A');
    const pull = await createRoutine('Pull A');
    const cycle = await getOrCreateActiveCycle();
    await saveCycle({ ...cycle, routineIds: [push.id, pull.id], currentIndex: 0 });

    const session = await startSession(push);
    await finishSession(session.id);

    expect((await getActiveCycle())?.currentIndex).toBe(1);
  });

  it('re-anchors the rotation when a routine is trained out of order', async () => {
    const push = await createRoutine('Push A');
    const pull = await createRoutine('Pull A');
    const legs = await createRoutine('Legs');
    const cycle = await getOrCreateActiveCycle();
    await saveCycle({
      ...cycle,
      routineIds: [push.id, pull.id, legs.id],
      currentIndex: 0,
    });

    const session = await startSession(legs);
    await finishSession(session.id);

    // position(legs) + 1 wraps back to the start, not currentIndex + 1.
    expect((await getActiveCycle())?.currentIndex).toBe(0);
  });

  it('leaves the rotation alone when the routine was archived mid-session', async () => {
    const push = await createRoutine('Push A');
    const pull = await createRoutine('Pull A');
    const cycle = await getOrCreateActiveCycle();
    await saveCycle({ ...cycle, routineIds: [push.id, pull.id], currentIndex: 1 });

    const session = await startSession(pull);
    // archiveRoutine strips it from every cycle, so advanceAfter can no
    // longer find it. No special case is needed: indexOf returns -1 and
    // advanceAfter returns the cycle unchanged.
    await archiveRoutine(pull.id);
    await finishSession(session.id);

    const after = await getActiveCycle();
    expect(after?.routineIds).toEqual([push.id]);
    expect(after?.currentIndex).toBe(0);
    expect((await getSession(session.id))?.status).toBe('completed');
  });

  it('rejects an unknown session', async () => {
    await expect(finishSession('nope')).rejects.toThrow(/not found/i);
  });
});

describe('discardSession', () => {
  it('removes the session and every set logged into it', async () => {
    const routine = await createRoutine('Push A');
    const session = await startSession(routine);
    await logSet({
      sessionId: session.id,
      exerciseId: 'bench',
      setType: 'working',
      unit: 'lb',
      weight: 135,
      reps: 8,
    });

    await discardSession(session.id);

    expect(await getSession(session.id)).toBeUndefined();
    expect(await db.sets.count()).toBe(0);
  });

  it('leaves other sessions untouched', async () => {
    const push = await createRoutine('Push A');
    const first = await startSession(push);
    await logSet({
      sessionId: first.id,
      exerciseId: 'bench',
      setType: 'working',
      unit: 'lb',
      weight: 135,
      reps: 8,
    });
    await finishSession(first.id);

    const second = await startSession(push);
    await discardSession(second.id);

    expect(await getSession(first.id)).toBeDefined();
    expect(await db.sets.count()).toBe(1);
  });
});
