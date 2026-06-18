/**
 * @vitest-environment jsdom
 *
 * Integration tests for the live runner. These read as the user-facing behaviors
 * of `useRunner`/`Runner` — running source, recovering from errors, and keeping
 * the last good preview. Pure transform/eval edge cases live in the unit tests.
 */
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Runner } from './Runner';
import { useRunner, type UseRunnerOptions } from './useRunner';

describe('Runner', () => {
  it('renders the element exported by the source', () => {
    render(<Runner code="<p>hello world</p>" />);
    expect(screen.getByText('hello world')).toBeTruthy();
  });

  it('reports no error to onRendered when the source renders cleanly', () => {
    const onRendered = vi.fn();
    render(<Runner code="<p>ok</p>" onRendered={onRendered} />);
    expect(onRendered).toHaveBeenCalledWith(undefined);
  });

  it('reports a build error for source that fails to transpile, rendering nothing', () => {
    const onRendered = vi.fn();
    const { container } = render(<Runner code="export default <div>" onRendered={onRendered} />);
    expect(onRendered).toHaveBeenCalledTimes(1);
    expect(onRendered.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(container.textContent).toBe('');
  });

  it('catches a runtime error thrown while rendering the source (error boundary)', () => {
    const onRendered = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(
      <Runner
        code="export default function Boom() { throw new Error('kaboom'); }"
        onRendered={onRendered}
      />,
    );
    expect(onRendered).toHaveBeenCalled();
    const lastError = onRendered.mock.calls[onRendered.mock.calls.length - 1][0];
    expect(lastError).toBeInstanceOf(Error);
    expect(container.textContent).toBe('');
    consoleError.mockRestore();
  });
});

describe('useRunner', () => {
  function Harness(props: UseRunnerOptions) {
    const { element, error } = useRunner(props);
    return (
      <React.Fragment>
        <div data-testid="error">{error ?? ''}</div>
        <div data-testid="output">{element}</div>
      </React.Fragment>
    );
  }

  it('renders the running element with no error for valid code', () => {
    render(<Harness code="<p>live</p>" />);
    expect(screen.getByTestId('output').textContent).toBe('live');
    expect(screen.getByTestId('error').textContent).toBe('');
  });

  it('surfaces the error and keeps the last good element on a broken edit', async () => {
    const { rerender } = render(<Harness code="<p>first</p>" />);
    expect(screen.getByTestId('output').textContent).toBe('first');

    await act(async () => {
      rerender(<Harness code="export default <div>" />);
    });

    // The error is reported...
    expect(screen.getByTestId('error').textContent).not.toBe('');
    // ...but the previously rendered output is still shown (cache).
    expect(screen.getByTestId('output').textContent).toBe('first');
  });

  it('clears the preview on error when disableCache is set', async () => {
    const { rerender } = render(<Harness code="<p>first</p>" disableCache />);
    expect(screen.getByTestId('output').textContent).toBe('first');

    await act(async () => {
      rerender(<Harness code="export default <div>" disableCache />);
    });

    expect(screen.getByTestId('error').textContent).not.toBe('');
    expect(screen.getByTestId('output').textContent).toBe('');
  });

  it('recovers and renders new output once the code is valid again', async () => {
    const { rerender } = render(<Harness code="<p>first</p>" />);

    await act(async () => {
      rerender(<Harness code="export default <div>" />);
    });
    expect(screen.getByTestId('error').textContent).not.toBe('');

    await act(async () => {
      rerender(<Harness code="<p>second</p>" />);
    });
    expect(screen.getByTestId('error').textContent).toBe('');
    expect(screen.getByTestId('output').textContent).toBe('second');
  });

  it('keeps the error set (no flash to null) when editing between two broken states', async () => {
    const reported: Array<string | null> = [];
    function Probe({ code }: { code: string }) {
      const { element, error } = useRunner({ code });
      React.useEffect(() => {
        reported.push(error);
      }, [error]);
      return element;
    }

    const { rerender } = render(<Probe code="<p>ok</p>" />);
    await act(async () => {
      rerender(<Probe code="export default <div>" />);
    });
    const firstError = reported.findIndex((value) => value !== null);
    expect(firstError).toBeGreaterThanOrEqual(0);

    await act(async () => {
      rerender(<Probe code="export default <section>" />);
    });

    // Once an error is showing, editing into another broken state must not blink
    // it back to `null` in between.
    expect(reported.slice(firstError)).not.toContain(null);
  });

  it('clears the error when the source is restored to the exact code the cache last rendered', async () => {
    const working = '<p>working</p>';
    const { rerender } = render(<Harness code={working} />);
    expect(screen.getByTestId('output').textContent).toBe('working');

    await act(async () => {
      rerender(<Harness code="export default <div>" />);
    });
    expect(screen.getByTestId('error').textContent).not.toBe('');

    // Restore the source to the EXACT working code the cached element is already
    // showing — the runner must still clear the error, not wait for a further edit.
    await act(async () => {
      rerender(<Harness code={working} />);
    });
    expect(screen.getByTestId('error').textContent).toBe('');
    expect(screen.getByTestId('output').textContent).toBe('working');
  });

  it('clears the error on the first successful render even when the first render errored', async () => {
    // Mount straight into a broken state — there is no prior successful render to
    // cache, so the error must still clear on the very next good edit (not the
    // one after).
    const { rerender } = render(<Harness code="export default <div>" />);
    expect(screen.getByTestId('error').textContent).not.toBe('');

    await act(async () => {
      rerender(<Harness code="<p>fixed</p>" />);
    });
    expect(screen.getByTestId('error').textContent).toBe('');
    expect(screen.getByTestId('output').textContent).toBe('fixed');
  });
});
