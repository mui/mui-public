/**
 * @vitest-environment jsdom
 *
 * Parity spec for `CodeHighlighterClient`'s fallback↔content swap after it was
 * migrated onto `useCoordinatedSwap`. Pins the CH-specific swap behaviors the
 * migration touched: the missing-hoist validation throw, the no-fallback direct
 * render, and showing the fallback (with the hoist hook wired) while not ready.
 * (The swap mechanics themselves - force-mount-once, settle gate, nested
 * suppression, holdGate - are unit-tested in CoordinatedLazy/useCoordinatedSwap.)
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, renderHook, screen, waitFor, act } from '@testing-library/react';
import { CoordinatedContentContext } from '../CoordinatedLazy/CoordinatedContentContext';
import { CodeContext, type CodeContext as CodeContextValue } from '../CodeProvider/CodeContext';
import { CodeControllerContext } from '../CodeControllerContext';
import { CodeHighlighterClient } from './CodeHighlighterClient';
import { CodeHighlighterContext } from './CodeHighlighterContext';
import { useCodeFallback } from './useCodeFallback';
import * as resolveFallbackCriticalModule from './resolveFallbackCritical';
import type { Code, ContentLoadingProps } from './types';

const hast = { type: 'root' as const, children: [{ type: 'text' as const, value: 'x' }] };
const readyCode = { Default: { source: { hast } } } as unknown as Code;

function Content() {
  return <div data-testid="content">content</div>;
}

/** A ContentLoading that correctly wires the hoist hook. */
function GoodLoading(props: ContentLoadingProps<{}>) {
  useCodeFallback(props);
  return <div data-testid="loading">loading</div>;
}

/** A ContentLoading that forgot to call useCodeFallback (the misuse CH detects). */
function BadLoading(_props: ContentLoadingProps<{}>) {
  return <div data-testid="loading">loading</div>;
}

/**
 * A content component that loads asynchronously - it reports readiness through
 * `CoordinatedContentContext` once mounted, the way `LazyContent` does after its
 * dynamic import resolves.
 */
function DynamicContent() {
  const reportReady = React.useContext(CoordinatedContentContext).reportReady;
  React.useEffect(() => {
    reportReady?.();
  }, [reportReady]);
  return <div data-testid="content">content</div>;
}

class Boundary extends React.Component<{ children: React.ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    return this.state.error ? (
      <div data-testid="error">{this.state.error.message}</div>
    ) : (
      this.props.children
    );
  }
}

describe('CodeHighlighterClient swap (migrated onto useCoordinatedSwap)', () => {
  it('renders content directly when there is no fallback', () => {
    render(
      <CodeHighlighterClient variants={['Default']} precompute={readyCode}>
        <Content />
      </CodeHighlighterClient>,
    );
    expect(screen.getByTestId('content')).toBeTruthy();
  });

  it('force-mounts the fallback with a wired useCodeFallback and does not throw', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <Boundary>
        <CodeHighlighterClient
          variants={['Default']}
          precompute={readyCode}
          fallback={<GoodLoading component={null} />}
        >
          <Content />
        </CodeHighlighterClient>
      </Boundary>,
    );
    // The fallback force-mounts (so useCodeFallback can hoist); because the hook
    // is wired, the missing-hoist validation does not fire.
    expect(screen.getByTestId('loading')).toBeTruthy();
    expect(screen.queryByTestId('error')).toBeNull();
    errorSpy.mockRestore();
  });

  it('throws MissingFallbackHoist when ContentLoading omits useCodeFallback', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <Boundary>
        <CodeHighlighterClient variants={['Default']} fallback={<BadLoading component={null} />}>
          <Content />
        </CodeHighlighterClient>
      </Boundary>,
    );
    expect(screen.getByTestId('error').textContent).toMatch(/fallback/i);
    errorSpy.mockRestore();
  });

  it('throws when a dynamic content loads without a ContentLoading (would flash empty)', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <Boundary>
        <CodeHighlighterClient variants={['Default']} precompute={readyCode}>
          <DynamicContent />
        </CodeHighlighterClient>
      </Boundary>,
    );
    expect(screen.getByTestId('error').textContent).toMatch(/ContentLoading/i);
    errorSpy.mockRestore();
  });

  it('does not throw for a dynamic content when a ContentLoading exists', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <Boundary>
        <CodeHighlighterClient
          variants={['Default']}
          precompute={readyCode}
          fallback={<GoodLoading component={null} />}
        >
          <DynamicContent />
        </CodeHighlighterClient>
      </Boundary>,
    );
    // The fallback covers the dynamic load, so there is no flash and no error.
    expect(screen.queryByTestId('error')).toBeNull();
    expect(screen.getByTestId('loading')).toBeTruthy();
    errorSpy.mockRestore();
  });
});

describe('CodeHighlighterClient idle highlight/enhance swap', () => {
  it('forwards a bounded timeout so requestIdleCallback cannot starve the swap', () => {
    // The default `'idle'` highlight/enhance gates defer their swap to
    // `requestIdleCallback`, which a busy main thread can starve INDEFINITELY —
    // leaving code stuck at its un-highlighted first paint until a full reload. The
    // gates must schedule with a finite `timeout` so the swap is guaranteed. Here a
    // fake `requestIdleCallback` records the forwarded options (and never runs the
    // task, simulating a thread that never goes idle).
    const host = globalThis as { requestIdleCallback?: unknown; cancelIdleCallback?: unknown };
    const previous = { ric: host.requestIdleCallback, cic: host.cancelIdleCallback };
    const timeouts: Array<number | undefined> = [];
    host.requestIdleCallback = (_task: () => void, options?: { timeout?: number }) => {
      timeouts.push(options?.timeout);
      return 1;
    };
    host.cancelIdleCallback = () => {};
    try {
      render(
        <CodeHighlighterClient
          variants={['Default']}
          precompute={readyCode}
          highlightAfter="idle"
          enhanceAfter="idle"
        >
          <Content />
        </CodeHighlighterClient>,
      );
      expect(timeouts.length).toBeGreaterThan(0); // the idle gate(s) scheduled
      // Every idle swap carries a finite deadline — none is left unbounded.
      expect(timeouts.every((timeout) => typeof timeout === 'number' && timeout > 0)).toBe(true);
    } finally {
      host.requestIdleCallback = previous.ric;
      host.cancelIdleCallback = previous.cic;
    }
  });
});

describe('CodeHighlighterClient lazy loader accessors (needsFallback path)', () => {
  it('renders the fallback synchronously when only a lazy loadCodeFallbackLoader is provided (no throw)', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <Boundary>
        <CodeContext.Provider
          value={{
            // The fn is provisioned lazily (accessor present); validation must
            // not throw merely because the import hasn't resolved yet.
            loadCodeFallbackLoader: async () => async () => ({ code: readyCode }),
          }}
        >
          <CodeHighlighterClient
            variants={['Default']}
            url="file:///example/index.ts"
            fallback={<GoodLoading component={null} />}
          >
            <Content />
          </CodeHighlighterClient>
        </CodeContext.Provider>
      </Boundary>,
    );
    // First synchronous commit shows the fallback; no validation throw.
    expect(screen.getByTestId('loading')).toBeTruthy();
    expect(screen.queryByTestId('error')).toBeNull();
    errorSpy.mockRestore();
  });

  it('throws when a fallback is needed but no loader accessor (or data) is provisioned', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <Boundary>
        <CodeContext.Provider value={{}}>
          <CodeHighlighterClient
            variants={['Default']}
            url="file:///example/index.ts"
            fallback={<GoodLoading component={null} />}
          >
            <Content />
          </CodeHighlighterClient>
        </CodeContext.Provider>
      </Boundary>,
    );
    // Neither static data nor a loader accessor: the missing-loader guard fires.
    expect(screen.getByTestId('error')).toBeTruthy();
    errorSpy.mockRestore();
  });
});

describe('CodeHighlighterClient fallbackCritical demand-load wiring', () => {
  it('resolves the demand-loaded fallback with the active highlightAfter, promoting + stripping', async () => {
    const resolveSpy = vi.spyOn(resolveFallbackCriticalModule, 'resolveFallbackCritical');
    // What a precomputed loader hands back under highlightAfter:'init' — plain fallback +
    // a sparse highlighted-visible companion.
    const loadedCode = {
      Default: {
        fileName: 'index.ts',
        source: { hast },
        fallback: [['span', 'frame', 'x']],
        fallbackCritical: { 0: ['span', 'frame', [['span', 'pl-k', 'x']]] },
      },
    } as unknown as Code;
    render(
      <CodeContext.Provider
        value={{ loadCodeFallbackLoader: async () => async () => ({ code: loadedCode }) }}
      >
        <CodeHighlighterClient
          variants={['Default']}
          url="file:///index.ts"
          highlightAfter="init"
          fallback={<GoodLoading component={null} />}
        >
          <Content />
        </CodeHighlighterClient>
      </CodeContext.Provider>,
    );

    // The demand-load boundary must resolve the loaded code with the ACTIVE mode
    // ('init'), not a hardcoded one — otherwise a precomputed init client-load paints
    // un-highlighted.
    await waitFor(() => {
      expect(resolveSpy.mock.calls.some((args) => args[1] === 'init')).toBe(true);
    });
    const callIndex = resolveSpy.mock.calls.findIndex((args) => args[1] === 'init');
    expect(resolveSpy.mock.calls[callIndex][0]).toBe(loadedCode);
    expect(resolveSpy.mock.calls[callIndex][2]).toBe(false);
    // And the staging field is stripped from the resolved code — no leak to content.
    const resolved = resolveSpy.mock.results[callIndex].value as Code;
    const variant = resolved.Default;
    expect(
      variant && typeof variant === 'object' ? variant.fallbackCritical : undefined,
    ).toBeUndefined();
    resolveSpy.mockRestore();
  });
});

describe('CodeHighlighterClient editable grammar preload', () => {
  it('warms grammars for every file of an editable block, including extra files in another language', () => {
    // Regression: a controlled (editable) block must load the grammars for ALL
    // its files so live edits re-highlight. The scopes were derived from the
    // controlled-cleared speculative code and came back empty, so an editable
    // block's files — especially an extra file in a second language (here CSS) —
    // re-highlighted as plain text. The scopes must come from the block's own
    // files (`props.code`), independent of the controlled gate.
    const ensureParseSourceWorker = vi.fn();
    const editingEngineLoader = vi.fn(async () => ({}) as never);
    const editableCode = {
      Default: {
        fileName: 'index.tsx',
        source: 'export const value = 1;',
        extraFiles: { 'theme.css': { source: '.a { color: red; }' } },
      },
    } as unknown as Code;

    render(
      <CodeContext.Provider value={{ ensureParseSourceWorker, editingEngineLoader }}>
        <CodeControllerContext.Provider value={{ setCode: vi.fn() }}>
          <CodeHighlighterClient variants={['Default']} url="file:///index.tsx" code={editableCode}>
            <Content />
          </CodeHighlighterClient>
        </CodeControllerContext.Provider>
      </CodeContext.Provider>,
    );

    // Both the main file's (tsx) and the extra file's (css) grammars are warmed —
    // the css scope is the one that was missing before the fix.
    expect(ensureParseSourceWorker).toHaveBeenCalledWith(
      expect.arrayContaining(['source.tsx', 'source.css']),
    );
  });
});

describe('CodeHighlighterClient refresh', () => {
  it('refresh() re-runs the full variant loader (client re-fetch)', async () => {
    // The full load is routed through `useChunk`; `refresh()` re-runs its loader
    // regardless of the initial gating, so a fully-precomputed block still
    // re-fetches when refreshed.
    const loadIsomorphicCodeVariant = vi.fn(async () => ({
      code: { source: { hast } },
      dependencies: [],
      externals: {},
    }));
    const loadIsomorphicCodeVariantLoader = vi.fn(
      async () => loadIsomorphicCodeVariant,
    ) as unknown as CodeContextValue['loadIsomorphicCodeVariantLoader'];

    const { result } = renderHook(() => React.useContext(CodeHighlighterContext), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <CodeContext.Provider value={{ loadIsomorphicCodeVariantLoader }}>
          <CodeHighlighterClient
            variants={['Default']}
            precompute={readyCode}
            url="file:///example/index.ts"
          >
            {children}
          </CodeHighlighterClient>
        </CodeContext.Provider>
      ),
    });

    // The block is fully precomputed, so refresh is available via context.
    await waitFor(() => expect(result.current?.refresh).toBeTypeOf('function'));
    const callsBefore = loadIsomorphicCodeVariant.mock.calls.length;

    act(() => {
      result.current?.refresh?.();
    });

    // Refresh re-invokes the full variant loader.
    await waitFor(() =>
      expect(loadIsomorphicCodeVariant.mock.calls.length).toBeGreaterThan(callsBefore),
    );
  });
});
