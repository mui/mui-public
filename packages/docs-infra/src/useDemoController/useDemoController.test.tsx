/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, renderHook, act, fireEvent, waitFor } from '@testing-library/react';
import type { ControlledCode } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useDemoController } from './useDemoController';
import { resetTranspileClientForTests } from './transpileClientSingleton';

describe('useDemoController', () => {
  let originalWorker: typeof Worker | undefined;

  beforeAll(async () => {
    // Pre-warm the lazy engine chunks (the build/render `BuildEngine` and the PostCSS
    // `compileCss` toolchain) ONCE, so no single test pays their first dynamic-import
    // cost inside its `findBy*`/`waitFor` timeout window. The CSS-module test is hit
    // hardest — it's the first to load both — and would otherwise flake under full-suite
    // CPU load; warming here makes every render-based test's async window just the fast
    // transpile + compile + render.
    await Promise.all([import('./BuildEngine'), import('./compileCssWithPostcss')]);
  });

  beforeEach(() => {
    resetTranspileClientForTests();
    originalWorker = globalThis.Worker;
    // Force the main-thread fallback so transpilation is deterministic in tests
    // (and exercises the no-Worker path the SSR/old-browser fallback relies on).
    delete (globalThis as { Worker?: unknown }).Worker;
  });

  afterEach(() => {
    resetTranspileClientForTests();
    if (originalWorker) {
      (globalThis as { Worker: unknown }).Worker = originalWorker;
    }
  });

  it('starts with no code, no components, and an empty error map', () => {
    const { result } = renderHook(() => useDemoController());
    expect(result.current.code).toBeUndefined();
    expect(result.current.components).toBeUndefined();
    expect(result.current.errors).toEqual({});
  });

  it('builds a ready preview only for variants with a source, once transpiled', async () => {
    const { result } = renderHook(() => useDemoController());
    act(() => {
      result.current.setCode({
        Default: { source: 'export default () => null;' },
        Empty: { source: null }, // no source → never a component
      });
    });
    await waitFor(() => {
      expect(result.current.components && Object.keys(result.current.components)).toEqual([
        'Default',
      ]);
    });
  });

  it('drops components back to undefined when code is cleared', async () => {
    const { result } = renderHook(() => useDemoController());
    act(() => result.current.setCode({ Default: { source: 'export default () => null;' } }));
    await waitFor(() => expect(result.current.components).toBeDefined());
    act(() => result.current.setCode(undefined));
    expect(result.current.components).toBeUndefined();
  });

  it('keeps a baseline preview after reset() then a transpile error (StrictMode)', async () => {
    const { result } = renderHook(() => useDemoController(), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <React.StrictMode>{children}</React.StrictMode>
      ),
    });

    // A valid first edit becomes a live preview.
    act(() =>
      result.current.setCode({ Default: { source: 'export default () => "first edit";' } }),
    );
    await waitFor(() => expect(result.current.components?.Default).toBeDefined());

    // reset() clears the controlled code.
    act(() => result.current.setCode(undefined));
    await waitFor(() => expect(result.current.components).toBeUndefined());

    // The first edit AFTER reset is a TRANSPILATION error, carrying `.original` (the working
    // baseline) exactly as `useSourceEditing` re-tags a post-reset first edit. reset() must
    // have fully cleared per-variant build state so the baseline rebuilds and the broken edit
    // keeps it — instead of building the broken edit directly and leaving `components` blank.
    act(() =>
      result.current.setCode({
        Default: {
          source: 'export default () => <p', // unterminated JSX → transpile failure
          original: { source: 'export default () => "baseline";' },
        },
      }),
    );

    await waitFor(() => expect(result.current.errors.Default).toBeTruthy());
    expect(
      result.current.components?.Default,
      'after reset() + transpile error the baseline preview must remain, not go blank',
    ).toBeDefined();
  });

  // Integration through the full async pipeline (main-thread fallback transpile).
  function Controller({ load }: { load: ControlledCode }) {
    const { setCode, components, errors } = useDemoController();
    return (
      <div>
        <button type="button" onClick={() => setCode(load)}>
          load
        </button>
        <div data-testid="errors">{JSON.stringify(errors)}</div>
        {components
          ? Object.entries(components).map(([variant, node]) => (
              <div key={variant} data-testid={`variant-${variant}`}>
                {/* The live node is the lazy `DemoRunner`; the host owns the Suspense
                    boundary (here, mirroring `CodeHighlighterClient`'s build-time fallback). */}
                <React.Suspense fallback={null}>{node}</React.Suspense>
              </div>
            ))
          : null}
      </div>
    );
  }

  it('renders a variant that imports a CSS module with a scoped class', async () => {
    const load: ControlledCode = {
      Default: {
        source:
          "import styles from './styles.module.css';\nexport default () => <button className={styles.btn}>Go</button>;",
        extraFiles: { 'styles.module.css': { source: '.btn { color: rgb(1, 2, 3); }' } },
      },
    };
    render(<Controller load={load} />);
    fireEvent.click(screen.getByText('load'));

    // Generous timeout: this is an async integration build (transpile + PostCSS CSS
    // compile + lazy render), so the default 1s can be tight under full-suite load.
    const button = await screen.findByRole('button', { name: 'Go' }, { timeout: 5000 });
    // The scoped class on the button matches the scoped selector in the <style>.
    expect(button.className.startsWith('btn-')).toBe(true);
    const style = document.querySelector('[data-demo-styles] style');
    expect(style?.textContent).toContain(button.className);
  });

  it('renders a variant whose entry imports across subdirectories', async () => {
    const load: ControlledCode = {
      Default: {
        source: "import { Badge } from './widgets/Badge';\nexport default () => <Badge />;",
        extraFiles: {
          'lib/data.ts': { source: 'export const label = "from-lib";' },
          'widgets/Badge.tsx': {
            source:
              "import { label } from '../lib/data';\nexport const Badge = () => <span>{label}</span>;",
          },
        },
      },
    };
    render(<Controller load={load} />);
    fireEvent.click(screen.getByText('load'));
    expect(await screen.findByText('from-lib')).toBeTruthy();
  });

  it('lets an extra file import the main entry (circular)', async () => {
    const load: ControlledCode = {
      Default: {
        source:
          "import { Tag } from './Tag';\nexport const LABEL = 'shared';\nexport default () => <Tag />;",
        extraFiles: {
          'Tag.tsx': {
            source:
              "import { LABEL } from './index';\nexport const Tag = () => <span>{LABEL}</span>;",
          },
        },
      },
    };
    render(<Controller load={load} />);
    fireEvent.click(screen.getByText('load'));
    expect(await screen.findByText('shared')).toBeTruthy();
  });

  it("collects a broken variant's error without blanking a clean sibling", async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    // `s` is undefined inside the render function, so Broken throws when React
    // renders it (caught by the runner's boundary); Good renders cleanly.
    const load: ControlledCode = {
      Good: { source: 'export default function App() { return <span>ok</span>; }' },
      Broken: { source: 'export default function App() { return <div>{s}</div>; }' },
    };
    render(<Controller load={load} />);
    fireEvent.click(screen.getByText('load'));

    await screen.findByText('ok');
    await waitFor(() => {
      const errors = JSON.parse(screen.getByTestId('errors').textContent || '{}');
      expect(typeof errors.Broken).toBe('string');
    });
    const errors = JSON.parse(screen.getByTestId('errors').textContent || '{}');
    // The clean sibling is reported as null, not blanked by the broken one.
    expect(errors.Good ?? null).toBeNull();
    consoleError.mockRestore();
  });

  it('surfaces an entry that fails to transpile as a per-variant error', async () => {
    const load: ControlledCode = {
      Default: { source: 'export const x =' }, // syntax error — never transpiles
    };
    render(<Controller load={load} />);
    fireEvent.click(screen.getByText('load'));

    await waitFor(() => {
      const errors = JSON.parse(screen.getByTestId('errors').textContent || '{}');
      expect(typeof errors.Default).toBe('string');
    });
    // A variant that never transpiles has no preview node.
    expect(screen.queryByTestId('variant-Default')).toBeNull();
  });

  it('clears a prior transpile error when the code is reset', async () => {
    const { result } = renderHook(() => useDemoController());
    // A syntax error surfaces as a per-variant error...
    act(() => {
      result.current.setCode({ Default: { source: 'export const x =' } });
    });
    await waitFor(() => expect(result.current.errors.Default).toBeTruthy());

    // ...and reset() (which clears the code to `undefined`) must drop it, so the
    // error overlay doesn't linger over the restored original — nothing rebuilds
    // after a reset to clear it otherwise.
    act(() => result.current.setCode(undefined));
    await waitFor(() => expect(result.current.errors).toEqual({}));
  });
});

/** Minimal same-origin `BroadcastChannel` stand-in (jsdom ships none). */
class FakeBroadcastChannel {
  static groups = new Map<string, Set<FakeBroadcastChannel>>();

  onmessage: ((event: { data: unknown }) => void) | null = null;

  constructor(public name: string) {
    const group = FakeBroadcastChannel.groups.get(name) ?? new Set();
    group.add(this);
    FakeBroadcastChannel.groups.set(name, group);
  }

  postMessage(data: unknown) {
    const cloned = structuredClone(data);
    for (const peer of FakeBroadcastChannel.groups.get(this.name) ?? []) {
      if (peer !== this) {
        peer.onmessage?.({ data: cloned });
      }
    }
  }

  close() {
    FakeBroadcastChannel.groups.get(this.name)?.delete(this);
  }

  static reset() {
    FakeBroadcastChannel.groups.clear();
  }
}

describe('useDemoController — cross-tab sync', () => {
  beforeEach(() => {
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
  });

  afterEach(() => {
    FakeBroadcastChannel.reset();
    vi.unstubAllGlobals();
  });

  it('mirrors a code edit to another controller sharing the same url', () => {
    const { result: tabA } = renderHook(() => useDemoController({ url: 'demo-x' }));
    const { result: tabB } = renderHook(() => useDemoController({ url: 'demo-x' }));

    const edit: ControlledCode = { Default: { source: 'export default () => null;' } };
    act(() => tabA.current.setCode(edit));

    expect(tabB.current.code).toEqual(edit);
  });

  it('hands existing edits to a controller mounted after the edit', () => {
    const { result: tabA } = renderHook(() => useDemoController({ url: 'demo-x' }));
    const edit: ControlledCode = { Default: { source: 'export default () => null;' } };
    act(() => tabA.current.setCode(edit));

    // A controller that comes online later catches up to the in-flight edit.
    const { result: tabB } = renderHook(() => useDemoController({ url: 'demo-x' }));
    expect(tabB.current.code).toEqual(edit);
  });

  it('keeps demos with different urls independent', () => {
    const { result: tabA } = renderHook(() => useDemoController({ url: 'demo-a' }));
    const { result: tabB } = renderHook(() => useDemoController({ url: 'demo-b' }));

    act(() => tabA.current.setCode({ Default: { source: 'export default () => null;' } }));

    expect(tabB.current.code).toBeUndefined();
  });

  it('does not sync when crossTabSync is disabled', () => {
    const { result: tabA } = renderHook(() =>
      useDemoController({ url: 'demo-x', crossTabSync: false }),
    );
    const { result: tabB } = renderHook(() =>
      useDemoController({ url: 'demo-x', crossTabSync: false }),
    );

    act(() => tabA.current.setCode({ Default: { source: 'export default () => null;' } }));

    expect(tabB.current.code).toBeUndefined();
  });
});
