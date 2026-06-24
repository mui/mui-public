/**
 * @vitest-environment jsdom
 *
 * Contract for the client-highlight readiness gate: synchronously ready when
 * disabled, when there is nothing to wait for, or when the scopes are already
 * registered (warm); otherwise `false` until the grammars load, then `true`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useGrammarsReady } from './useGrammarsReady';
import * as grammarCache from '../pipeline/parseSource/grammarCache';
import { resetStarryNight } from '../pipeline/parseSource/parseSource';

beforeEach(() => {
  resetStarryNight();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useGrammarsReady', () => {
  it('is true synchronously when disabled', () => {
    const { result } = renderHook(() => useGrammarsReady(['source.tsx'], false));
    expect(result.current).toBe(true);
  });

  it('is true synchronously for an empty scope list', () => {
    const { result } = renderHook(() => useGrammarsReady([], true));
    expect(result.current).toBe(true);
  });

  it('is false on a cold cache, then true once the grammars load', async () => {
    const { result } = renderHook(() => useGrammarsReady(['source.tsx'], true));
    expect(result.current).toBe(false);

    await waitFor(() => expect(result.current).toBe(true));
  });

  it('is true on the first render when the grammars are already warm', async () => {
    await grammarCache.ensureGrammars(['source.css']);

    const { result } = renderHook(() => useGrammarsReady(['source.css'], true));
    expect(result.current).toBe(true);
  });

  it('fails open (ready becomes true) on a hard grammar load failure, instead of wedging', async () => {
    // Registration stays permanently false; the load hard-fails (a 404/network error).
    vi.spyOn(grammarCache, 'areGrammarsRegistered').mockReturnValue(false);
    const ensureSpy = vi
      .spyOn(grammarCache, 'ensureGrammars')
      .mockRejectedValue(new Error('grammar chunk failed to load'));

    const { result } = renderHook(() => useGrammarsReady(['source.tsx'], true));
    expect(result.current).toBe(false); // cold, waiting on the load

    // With registration permanently false, `ready` can only flip true via the
    // fail-open path firing after the rejected load — proving the block proceeds
    // (plain text for the failed scope) rather than wedging on `false` until reload.
    await waitFor(() => expect(result.current).toBe(true));
    expect(ensureSpy).toHaveBeenCalled();
  });

  it('fails open via the safety-net timeout when the grammar load hangs', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(grammarCache, 'areGrammarsRegistered').mockReturnValue(false);
      // Never settles (a stalled dynamic import) — without the timeout this wedges false.
      vi.spyOn(grammarCache, 'ensureGrammars').mockReturnValue(new Promise<void>(() => {}));

      const { result } = renderHook(() => useGrammarsReady(['source.tsx'], true));
      expect(result.current).toBe(false);

      // The deadline force-fails-open so the block proceeds (plain text) rather than
      // staying wedged on a load that never resolves.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(result.current).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
