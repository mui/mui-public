/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
// eslint-disable-next-line testing-library/no-manual-cleanup
import { render, screen, cleanup, act } from '@testing-library/react';
import { useCodeExternals } from '../CodeExternalsContext';
import { useControlledCode } from '../CodeControllerContext';
import { LiveDemoProvider } from './LiveDemoProvider';

afterEach(cleanup);

function Button() {
  return null;
}
const externals = { '@mui/material': { Button } };
const globals = { process: {} };

function Probe() {
  const externalsContext = useCodeExternals();
  const controller = useControlledCode();

  return (
    <React.Fragment>
      <span data-testid="externals">
        {Object.keys(externalsContext?.externals ?? {}).join(',')}
      </span>
      <span data-testid="globals">{Object.keys(externalsContext?.globals ?? {}).join(',')}</span>
      <span data-testid="controller">
        {[
          controller?.setCode ? 'setCode' : '',
          'errors' in (controller ?? {}) ? 'errors' : '',
          controller?.onActivate ? 'onActivate' : '',
        ]
          .filter(Boolean)
          .join(',')}
      </span>
      <span data-testid="code">{controller?.code ? 'edited' : 'original'}</span>
      <button
        type="button"
        onClick={() => controller?.setCode?.({ Default: { source: 'edited' } })}
      >
        edit
      </button>
    </React.Fragment>
  );
}

describe('LiveDemoProvider', () => {
  it('publishes the externals and globals it was given', () => {
    render(
      <LiveDemoProvider externals={externals} globals={globals}>
        <Probe />
      </LiveDemoProvider>,
    );

    expect(screen.getByTestId('externals').textContent).toBe('@mui/material');
    expect(screen.getByTestId('globals').textContent).toBe('process');
  });

  it('publishes a controller, so demos below it are live without a client.ts', () => {
    render(
      <LiveDemoProvider externals={externals}>
        <Probe />
      </LiveDemoProvider>,
    );

    expect(screen.getByTestId('controller').textContent).toBe('setCode,errors,onActivate');
    // Nothing is controlled until the first edit, so the host's build-time
    // render is what shows.
    expect(screen.getByTestId('code').textContent).toBe('original');
  });

  it('owns the controlled source from the first edit', () => {
    render(
      <LiveDemoProvider externals={externals}>
        <Probe />
      </LiveDemoProvider>,
    );

    act(() => {
      screen.getByRole('button', { name: 'edit' }).click();
    });

    expect(screen.getByTestId('code').textContent).toBe('edited');
  });

  it('defaults to an empty externals map rather than no context', () => {
    render(
      <LiveDemoProvider>
        <Probe />
      </LiveDemoProvider>,
    );

    expect(screen.getByTestId('externals').textContent).toBe('');
    expect(screen.getByTestId('globals').textContent).toBe('');
  });

  // A stable context value matters: it feeds `useDemoController`, and a new
  // identity every render would re-run the build effect.
  it('does not rebuild the context value on an unrelated re-render', () => {
    const values: unknown[] = [];
    function Recorder() {
      values.push(useCodeExternals());
      return null;
    }
    function Host({ tick }: { tick: number }) {
      return (
        <LiveDemoProvider externals={externals} globals={globals}>
          <span>{tick}</span>
          <Recorder />
        </LiveDemoProvider>
      );
    }

    const { rerender } = render(<Host tick={1} />);
    rerender(<Host tick={2} />);

    expect(values.length).toBeGreaterThan(1);
    expect(values[0]).toBe(values[values.length - 1]);
  });
});

describe('LiveDemoProvider globals', () => {
  it('warns nothing and stays undefined when no globals are passed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(
      <LiveDemoProvider externals={externals}>
        <Probe />
      </LiveDemoProvider>,
    );

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
