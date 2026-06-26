/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DemoRunner } from './DemoRunner';
import { transpileSource } from './transpileSource';
import type { Scope } from './types';

/** Transpile a raw source into the entry code `DemoRunner` consumes. */
const entry = (source: string) => transpileSource(source, { normalize: true });

/** A registry with no extra files — `React` is injected by the runner regardless. */
const emptyScope: Scope = { import: {} };

describe('DemoRunner', () => {
  it('evaluates and renders the transpiled entry', () => {
    render(<DemoRunner runnerCode={entry('<p>hello world</p>')} scope={emptyScope} />);
    expect(screen.getByText('hello world')).toBeTruthy();
  });

  it('renders provided CSS as a `<style>` in its own output, not document.head', () => {
    const css = '.btn-x { color: rgb(1, 2, 3); }';
    render(<DemoRunner runnerCode={entry('<p>ok</p>')} scope={emptyScope} css={css} />);
    const style = document.querySelector('[data-demo-styles] style');
    expect(style?.textContent).toContain('.btn-x');
    expect(document.head.contains(style)).toBe(false);
  });

  it('reports null to onError for code that renders cleanly', () => {
    const onError = vi.fn();
    render(<DemoRunner runnerCode={entry('<p>ok</p>')} scope={emptyScope} onError={onError} />);
    expect(onError).toHaveBeenLastCalledWith(null);
  });

  it('reports the error message to onError for a runtime throw', () => {
    const onError = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <DemoRunner
        runnerCode={entry('export default function Boom() { throw new Error("kaboom"); }')}
        scope={emptyScope}
        onError={onError}
      />,
    );
    const lastArg = onError.mock.calls[onError.mock.calls.length - 1]?.[0];
    expect(typeof lastArg).toBe('string');
    expect(lastArg as string).toContain('kaboom');
    consoleError.mockRestore();
  });

  it('keeps the last good output when a later edit throws at render', async () => {
    const onError = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(
      <DemoRunner runnerCode={entry('<p>good</p>')} scope={emptyScope} onError={onError} />,
    );
    expect(screen.getByText('good')).toBeTruthy();

    rerender(
      <DemoRunner
        runnerCode={entry('export default function Boom() { throw new Error("x"); }')}
        scope={emptyScope}
        onError={onError}
      />,
    );

    // Error surfaced...
    await waitFor(() => {
      expect(typeof onError.mock.calls[onError.mock.calls.length - 1]?.[0]).toBe('string');
    });
    // ...but the previous output is still on screen.
    expect(screen.getByText('good')).toBeTruthy();
    consoleError.mockRestore();
  });

  it('shows the fallback when the FIRST render throws (no last-good element yet)', async () => {
    const onError = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <DemoRunner
        runnerCode={entry('export default function Boom() { throw new Error("x"); }')}
        scope={emptyScope}
        onError={onError}
        fallback={<p>BUILD TIME</p>}
      />,
    );

    // The very first render throws, so there is no last-good element — the build-time
    // `fallback` shows instead of blanking (the regression on a render-error first edit).
    await waitFor(() => {
      expect(typeof onError.mock.calls[onError.mock.calls.length - 1]?.[0]).toBe('string');
    });
    expect(screen.getByText('BUILD TIME')).toBeTruthy();
    consoleError.mockRestore();
  });

  it('keeps the last good output, not the fallback, when a later edit throws', async () => {
    const onError = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(
      <DemoRunner
        runnerCode={entry('<p>good</p>')}
        scope={emptyScope}
        onError={onError}
        fallback={<p>BUILD TIME</p>}
      />,
    );
    expect(screen.getByText('good')).toBeTruthy();

    rerender(
      <DemoRunner
        runnerCode={entry('export default function Boom() { throw new Error("x"); }')}
        scope={emptyScope}
        onError={onError}
        fallback={<p>BUILD TIME</p>}
      />,
    );

    await waitFor(() => {
      expect(typeof onError.mock.calls[onError.mock.calls.length - 1]?.[0]).toBe('string');
    });
    // A successful render happened first, so its element is kept — the fallback is ignored.
    expect(screen.getByText('good')).toBeTruthy();
    expect(screen.queryByText('BUILD TIME')).toBeNull();
    consoleError.mockRestore();
  });
});
