/**
 * @vitest-environment jsdom
 *
 * Contract for the client-highlight readiness gate: synchronously ready when
 * disabled or when the engine is already loaded (warm); otherwise `false` until
 * the engine loads, then `true`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useHighlighterReady } from './useHighlighterReady';
import * as highlighterCache from '../pipeline/parseSource/highlighterCache';
import { resetHighlighter } from '../pipeline/parseSource/parseSource';

beforeEach(() => {
  resetHighlighter();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useHighlighterReady', () => {
  it('is true synchronously when disabled', () => {
    const { result } = renderHook(() => useHighlighterReady(false));
    expect(result.current).toBe(true);
  });

  it('is false on a cold cache, then true once the engine loads', async () => {
    const { result } = renderHook(() => useHighlighterReady(true));
    expect(result.current).toBe(false);

    await waitFor(() => expect(result.current).toBe(true));
  });

  it('is true on the first render when the engine is already warm', async () => {
    await highlighterCache.loadHighlighter();

    const { result } = renderHook(() => useHighlighterReady(true));
    expect(result.current).toBe(true);
  });

  it('fails open (ready becomes true) on a hard engine load failure, instead of wedging', async () => {
    // The engine stays unloaded; the load hard-fails (a 404/network error).
    vi.spyOn(highlighterCache, 'isHighlighterLoaded').mockReturnValue(false);
    const loadSpy = vi
      .spyOn(highlighterCache, 'loadHighlighter')
      .mockRejectedValue(new Error('engine chunk failed to load'));

    const { result } = renderHook(() => useHighlighterReady(true));
    expect(result.current).toBe(false); // cold, waiting on the load

    // With the engine permanently unloaded, `ready` can only flip true via the
    // fail-open path firing after the rejected load — proving the block proceeds
    // (plain text) rather than wedging on `false` until reload.
    await waitFor(() => expect(result.current).toBe(true));
    expect(loadSpy).toHaveBeenCalled();
  });

  it('loads once across re-renders while the engine is loading', () => {
    vi.spyOn(highlighterCache, 'isHighlighterLoaded').mockReturnValue(false);
    // Pending (never settles), so the block stays in its loading window across renders.
    const loadSpy = vi
      .spyOn(highlighterCache, 'loadHighlighter')
      .mockReturnValue(new Promise<void>(() => {}));

    const { rerender } = renderHook(() => useHighlighterReady(true));
    rerender();
    rerender();

    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it('fails open via the safety-net timeout when the engine load hangs', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(highlighterCache, 'isHighlighterLoaded').mockReturnValue(false);
      // Never settles (a stalled dynamic import) — without the timeout this wedges false.
      vi.spyOn(highlighterCache, 'loadHighlighter').mockReturnValue(new Promise<void>(() => {}));

      const { result } = renderHook(() => useHighlighterReady(true));
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
