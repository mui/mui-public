/**
 * @vitest-environment jsdom
 */
import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
// eslint-disable-next-line testing-library/no-manual-cleanup -- root vitest config does not set `globals: true`, so RTL's auto `afterEach(cleanup)` is a no-op here.
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { LazyContent } from './LazyContent';
import { createSettleGate } from '../useCoordinated/createSettleGate';

afterEach(cleanup);

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
