import { db, resetDbForTests } from './db';
import { createRoutine } from './routines';
import { getInProgressSession, startSession } from './sessions';

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
