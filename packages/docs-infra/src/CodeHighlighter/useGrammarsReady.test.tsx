/**
 * @vitest-environment jsdom
 *
 * Contract for the client-highlight readiness gate: synchronously ready when
 * disabled, when there is nothing to wait for, or when the scopes are already
 * registered (warm); otherwise `false` until the grammars load, then `true`.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
// eslint-disable-next-line testing-library/no-manual-cleanup -- root vitest config does not set `globals: true`, so RTL's auto cleanup is a no-op here.
import { renderHook, cleanup, waitFor } from '@testing-library/react';
import { useGrammarsReady } from './useGrammarsReady';
import { ensureGrammars } from '../pipeline/parseSource/grammarCache';
import { resetStarryNight } from '../pipeline/parseSource/parseSource';

beforeEach(() => {
  resetStarryNight();
});

afterEach(cleanup);

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
    await ensureGrammars(['source.css']);

    const { result } = renderHook(() => useGrammarsReady(['source.css'], true));
    expect(result.current).toBe(true);
  });
});
