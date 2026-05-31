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
import { describe, it, expect, afterEach, vi } from 'vitest';
// eslint-disable-next-line testing-library/no-manual-cleanup -- root vitest config does not set `globals: true`, so RTL's auto `afterEach(cleanup)` is a no-op here.
import { render, screen, cleanup } from '@testing-library/react';
import { CoordinatedContentContext } from '../CoordinatedLazy/CoordinatedContentContext';
import { CodeContext } from '../CodeProvider/CodeContext';
import { CodeHighlighterClient } from './CodeHighlighterClient';
import { useCodeFallback } from './useCodeFallback';
import type { Code, ContentLoadingProps } from './types';

afterEach(cleanup);

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
