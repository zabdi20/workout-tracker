import { act, renderHook } from '@testing-library/react';
import { STORAGE_FULL_MESSAGE, useWriteError } from './useWriteError';

it('resolves true when the write lands and false when it fails, surfacing the message', async () => {
  const { result } = renderHook(() => useWriteError());
  let ok: boolean | undefined;
  await act(async () => { ok = await result.current.run(async () => {}); });
  expect(ok).toBe(true);
  await act(async () => { ok = await result.current.run(async () => { throw new Error('quota exceeded'); }); });
  expect(ok).toBe(false);
  expect(result.current.error).toBe('quota exceeded');
});

it('turns a quota error into the storage-full message', async () => {
  const { result } = renderHook(() => useWriteError());
  let ok: boolean | undefined;
  await act(async () => {
    ok = await result.current.run(async () => { throw new DOMException('full', 'QuotaExceededError'); });
  });
  expect(ok).toBe(false);
  expect(result.current.error).toBe(STORAGE_FULL_MESSAGE);
});

it('finds a quota error inside a Dexie abort', async () => {
  const { result } = renderHook(() => useWriteError());
  await act(async () => {
    await result.current.run(async () => {
      throw Object.assign(new Error('Transaction aborted'), {
        name: 'AbortError',
        inner: new DOMException('full', 'QuotaExceededError'),
      });
    });
  });
  expect(result.current.error).toBe(STORAGE_FULL_MESSAGE);
});

it('keeps the message of an abort that holds no quota error', async () => {
  const { result } = renderHook(() => useWriteError());
  await act(async () => {
    await result.current.run(async () => {
      throw Object.assign(new Error('Transaction aborted'), {
        name: 'AbortError',
        inner: new Error('constraint'),
      });
    });
  });
  expect(result.current.error).toBe('Transaction aborted');
});
