import { act, renderHook } from '@testing-library/react';
import { useWriteError } from './useWriteError';

it('resolves true when the write lands and false when it fails, surfacing the message', async () => {
  const { result } = renderHook(() => useWriteError());
  let ok: boolean | undefined;
  await act(async () => { ok = await result.current.run(async () => {}); });
  expect(ok).toBe(true);
  await act(async () => { ok = await result.current.run(async () => { throw new Error('quota exceeded'); }); });
  expect(ok).toBe(false);
  expect(result.current.error).toBe('quota exceeded');
});
