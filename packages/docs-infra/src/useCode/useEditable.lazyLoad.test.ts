/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useEditable, preloadEditableEngine, resetEditableEngineCache } from './useEditable';
import * as EditingEngine from './EditingEngine';
import type { EditingEngineModule } from './editingEngineCache';

// These tests exercise the COLD load-on-demand path, so each one starts from an
// empty module cache. The shared `useEditable.test.ts` warms the cache once for
// its synchronous assertions; here we deliberately reset it per test so the
// loader actually runs and `contentEditable` only attaches after it resolves.
beforeEach(() => {
  resetEditableEngineCache();
});

afterEach(() => {
  document.body.innerHTML = '';
  window.getSelection()?.removeAllRanges();
});

/** A `<pre>` with `contentEditable` explicitly at its default so the attach is observable. */
function makePre(content: string) {
  const element = document.createElement('pre');
  element.contentEditable = 'inherit';
  element.textContent = content;
  document.body.appendChild(element);
  return element;
}

const isEditable = (element: HTMLElement) =>
  ['plaintext-only', 'true'].includes(element.contentEditable);

describe('useEditable lazy engine loading (cold cache)', () => {
  it('eager: invokes the loader, no-ops the edit proxy until it resolves, then attaches', async () => {
    const element = makePre('hello');
    const ref = { current: element };

    // A loader we resolve by hand, so we can observe the pre-load window.
    let resolveEngine!: (create: EditingEngineModule) => void;
    const engineLoader = vi.fn(
      () =>
        new Promise<EditingEngineModule>((resolve) => {
          resolveEngine = resolve;
        }),
    );

    const { result } = renderHook(() => useEditable(ref, () => {}, { engineLoader }));

    // The loader is kicked off on mount, but the engine hasn't resolved yet.
    expect(engineLoader).toHaveBeenCalledTimes(1);
    expect(element.contentEditable).toBe('inherit');

    // Pre-load, the `edit` proxy is inert: getState returns the empty snapshot
    // and the mutators are silent no-ops.
    expect(result.current.getState()).toEqual({
      text: '',
      position: { position: 0, extent: 0, content: '', line: 0 },
    });
    expect(() => {
      result.current.update('x');
      result.current.insert('y');
      result.current.move(0);
    }).not.toThrow();

    // Each pre-load snapshot is a fresh object — never a shared mutable singleton.
    expect(result.current.getState()).not.toBe(result.current.getState());

    // Resolving the loader attaches contentEditable.
    await act(async () => {
      resolveEngine(EditingEngine);
    });
    await waitFor(() => expect(isEditable(element)).toBe(true));
  });

  it('interaction: warms on hover without attaching, commits on focus, reuses the warm cache', async () => {
    const element = makePre('hello');
    const ref = { current: element };
    const engineLoader = vi.fn(async () => EditingEngine);

    renderHook(() => useEditable(ref, () => {}, { engineLoader, activation: 'interaction' }));

    // Nothing loads or attaches on mount.
    expect(engineLoader).not.toHaveBeenCalled();
    expect(element.contentEditable).toBe('inherit');

    // Hover warms the engine (loads it) but does not attach contentEditable.
    await act(async () => {
      element.dispatchEvent(new Event('pointerenter'));
    });
    expect(engineLoader).toHaveBeenCalledTimes(1);
    expect(element.contentEditable).toBe('inherit');

    // Focus commits: attaches from the now-warm cache, without a second load.
    await act(async () => {
      element.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(isEditable(element)).toBe(true));
    expect(engineLoader).toHaveBeenCalledTimes(1);
  });

  it('interaction: removes its pre-commit listeners on unmount', () => {
    const element = makePre('hello');
    const ref = { current: element };
    const removeSpy = vi.spyOn(element, 'removeEventListener');

    const { unmount } = renderHook(() =>
      useEditable(ref, () => {}, {
        engineLoader: async () => EditingEngine,
        activation: 'interaction',
      }),
    );

    unmount();

    const removed = removeSpy.mock.calls.map((call) => call[0]);
    expect(removed).toContain('pointerenter');
    expect(removed).toContain('pointerdown');
    expect(removed).toContain('focus');
  });

  it('attaches when a disabled block becomes editable and detaches when disabled again', async () => {
    const element = makePre('hello');
    const ref = { current: element };

    // Warm the cache so the disabled->editable attach happens synchronously
    // within `act`; this test is about the toggle, not the load round-trip.
    await preloadEditableEngine();

    const { rerender } = renderHook((props) => useEditable(ref, () => {}, props.opts), {
      initialProps: { opts: { disabled: true } as { disabled: boolean } },
    });

    // Disabled blocks never attach contentEditable.
    expect(element.contentEditable).toBe('inherit');

    // Becoming editable attaches the engine for the first time.
    rerender({ opts: { disabled: false } });
    await waitFor(() => expect(isEditable(element)).toBe(true));

    // Becoming disabled again detaches and restores the prior contentEditable.
    rerender({ opts: { disabled: true } });
    await waitFor(() => expect(element.contentEditable).toBe('inherit'));
  });

  it('fires onActivate once on mount in eager mode', async () => {
    const element = makePre('hello');
    const ref = { current: element };
    const onActivate = vi.fn();
    const engineLoader = vi.fn(async () => EditingEngine);

    renderHook(() => useEditable(ref, () => {}, { engineLoader, onActivate }));

    await waitFor(() => expect(onActivate).toHaveBeenCalledTimes(1));
  });

  it('fires onActivate once on first engagement in interaction mode', async () => {
    const element = makePre('hello');
    const ref = { current: element };
    const onActivate = vi.fn();
    const engineLoader = vi.fn(async () => EditingEngine);

    renderHook(() =>
      useEditable(ref, () => {}, { engineLoader, activation: 'interaction', onActivate }),
    );

    // Not activated on mount in interaction mode.
    expect(onActivate).not.toHaveBeenCalled();

    // Hover (warm) activates the block.
    await act(async () => {
      element.dispatchEvent(new Event('pointerenter'));
    });
    expect(onActivate).toHaveBeenCalledTimes(1);

    // A later focus (commit) does not re-fire it — once per block lifetime.
    await act(async () => {
      element.dispatchEvent(new Event('focus'));
    });
    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});
