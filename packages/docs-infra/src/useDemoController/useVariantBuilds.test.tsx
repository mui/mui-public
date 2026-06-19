/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { ControlledCode } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useVariantBuilds } from './useVariantBuilds';
import type { Transpile } from './transpileSource';

/** A transpile whose every call is recorded and resolved/rejected by hand. */
function makeControllableTranspile() {
  const calls: Array<{
    source: string;
    resolve: (code: string) => void;
    reject: (reason: unknown) => void;
    signal?: AbortSignal;
  }> = [];
  const transpile: Transpile = (source, _options, signal) =>
    new Promise<string>((resolve, reject) => {
      calls.push({ source, resolve, reject, signal });
    });
  return { transpile, calls };
}

const variant = (source: string) => ({ source });

describe('useVariantBuilds — first build is never cancelled', () => {
  it('defers an edit that arrives mid-first-build, builds the baseline, then the edit', async () => {
    const { transpile, calls } = makeControllableTranspile();
    const report = vi.fn();
    const { result, rerender } = renderHook(
      ({ code }: { code: ControlledCode }) => useVariantBuilds(code, transpile, {}, report),
      { initialProps: { code: { Default: variant('ORIG') } } },
    );

    // The first build transpiles the entry and is in flight.
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].source).toBe('ORIG');
    expect(calls[0].signal?.aborted).toBe(false);

    // Edit BEFORE the first build settles: it must not abort the first build, and
    // must not start a second build yet — the edit is deferred.
    rerender({ code: { Default: variant('EDIT') } });
    expect(calls).toHaveLength(1);
    expect(calls[0].signal?.aborted, 'the first build must not be cancelled').toBe(false);

    // Resolve the baseline → it lands, then the deferred edit starts building.
    await act(async () => {
      calls[0].resolve('ORIG_OUT');
    });
    await waitFor(() => expect(result.current.Default?.runnerCode).toBe('ORIG_OUT'));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].source).toBe('EDIT');

    // Resolve the edit → the preview swaps to it.
    await act(async () => {
      calls[1].resolve('EDIT_OUT');
    });
    await waitFor(() => expect(result.current.Default?.runnerCode).toBe('EDIT_OUT'));
    expect(report).not.toHaveBeenCalled();
  });

  it('cancels a later edit normally once the first build has settled', async () => {
    const { transpile, calls } = makeControllableTranspile();
    const report = vi.fn();
    const { result, rerender } = renderHook(
      ({ code }: { code: ControlledCode }) => useVariantBuilds(code, transpile, {}, report),
      { initialProps: { code: { Default: variant('ORIG') } } },
    );

    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => {
      calls[0].resolve('ORIG_OUT'); // first build settles
    });
    await waitFor(() => expect(result.current.Default?.runnerCode).toBe('ORIG_OUT'));

    // First edit after the baseline — builds (no defer).
    rerender({ code: { Default: variant('EDIT_A') } });
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].source).toBe('EDIT_A');

    // A newer edit now ABORTS the in-flight EDIT_A build (first build is done).
    rerender({ code: { Default: variant('EDIT_B') } });
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[1].signal?.aborted, 'a later edit cancels the previous in-flight build').toBe(
      true,
    );
    expect(calls[2].source).toBe('EDIT_B');
  });

  it('builds the `.original` baseline first, then the edit, from one state', async () => {
    const { transpile, calls } = makeControllableTranspile();
    const report = vi.fn();
    // Stable across renders (a fresh object each render would defeat the per-input
    // build cache), mirroring how the controller passes immutable controlled code.
    const code: ControlledCode = { Default: { source: 'EDIT', original: { source: 'ORIG' } } };
    const { result } = renderHook(() => useVariantBuilds(code, transpile, {}, report));

    // A single state carrying `.original` builds the ORIGINAL baseline first...
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].source).toBe('ORIG');

    // ...then, once it lands, the edited `source` builds and swaps in.
    await act(async () => {
      calls[0].resolve('ORIG_OUT');
    });
    await waitFor(() => expect(result.current.Default?.runnerCode).toBe('ORIG_OUT'));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].source).toBe('EDIT');

    await act(async () => {
      calls[1].resolve('EDIT_OUT');
    });
    await waitFor(() => expect(result.current.Default?.runnerCode).toBe('EDIT_OUT'));
    expect(report).not.toHaveBeenCalled();
  });
});
