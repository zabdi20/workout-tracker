import { requestPersistentStorage } from './storage';

describe('requestPersistentStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns false when the Storage API is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    await expect(requestPersistentStorage()).resolves.toBe(false);
  });

  it('does not re-request when storage is already persisted', async () => {
    const persist = vi.fn();
    vi.stubGlobal('navigator', {
      storage: { persisted: async () => true, persist },
    });
    await expect(requestPersistentStorage()).resolves.toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it('requests persistence when not yet granted', async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal('navigator', {
      storage: { persisted: async () => false, persist },
    });
    await expect(requestPersistentStorage()).resolves.toBe(true);
    expect(persist).toHaveBeenCalledOnce();
  });

  it('returns false when the request throws', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        persisted: async () => { throw new Error('denied'); },
        persist: vi.fn(),
      },
    });
    await expect(requestPersistentStorage()).resolves.toBe(false);
  });
});
