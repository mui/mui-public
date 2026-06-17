/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { LazyContent } from './LazyContent';
import { CoordinatedContentContext } from './CoordinatedContentContext';
import { createSettleGate } from '../useCoordinated/createSettleGate';

function Hello({ name }: { name: string }) {
  return <div data-testid="hello">Hello {name}</div>;
}

/** A manually-resolved import so tests can observe the loading window. */
function deferredImport() {
  let resolve!: (module: { default: typeof Hello }) => void;
  const promise = new Promise<{ default: typeof Hello }>((resolveImport) => {
    resolve = resolveImport;
  });
  return { content: () => promise, resolve };
}

describe('LazyContent', () => {
  it('shows the fallback while importing, then renders the component with its props', async () => {
    const { content, resolve } = deferredImport();
    render(
      <LazyContent
        content={content}
        props={{ name: 'World' }}
        fallback={<div data-testid="fallback">loading</div>}
      />,
    );

    expect(screen.getByTestId('fallback')).toBeTruthy();
    expect(screen.queryByTestId('hello')).toBeNull();

    await act(async () => {
      resolve({ default: Hello });
      await Promise.resolve();
    });

    const hello = await screen.findByTestId('hello');
    expect(hello.textContent).toBe('Hello World');
    expect(screen.queryByTestId('fallback')).toBeNull();
  });

  it('shows the coordinating context fallback during import when no explicit fallback is given', async () => {
    const { content, resolve } = deferredImport();
    render(
      <CoordinatedContentContext.Provider
        value={{ hoisted: {}, fallback: <div data-testid="ctx-fallback">ctx loading</div> }}
      >
        <LazyContent content={content} props={{ name: 'World' }} />
      </CoordinatedContentContext.Provider>,
    );

    // No explicit `fallback` prop, so the swap's fallback (from context) covers
    // the import - the same placeholder keeps showing, with no empty flash.
    expect(screen.getByTestId('ctx-fallback')).toBeTruthy();
    expect(screen.queryByTestId('hello')).toBeNull();

    await act(async () => {
      resolve({ default: Hello });
      await Promise.resolve();
    });

    await screen.findByTestId('hello');
    expect(screen.queryByTestId('ctx-fallback')).toBeNull();
  });

  it('reports readiness to the gate only once the component has loaded', async () => {
    const { content, resolve } = deferredImport();
    const gate = createSettleGate();
    render(<LazyContent content={content} props={{ name: 'X' }} gate={gate} />);

    expect(gate.isSettled()).toBe(false); // pending while importing

    await act(async () => {
      resolve({ default: Hello });
      await Promise.resolve();
    });
    await waitFor(() => expect(gate.isSettled()).toBe(true));
  });
});
