/**
 * @vitest-environment jsdom
 *
 * Integration tests for `useStreamController` - how a controller reports
 * `loading` as its chunks register and settle, across the known-count and
 * streaming completion modes.
 */
import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { useStreamController } from './useStreamController';
import type { UseStreamControllerOptions } from './types';
import { useCoordinatedGate } from '../CoordinatedLazy/CoordinatedGateContext';
import { useSettleGate } from '../useCoordinated/useSettleGate';

afterEach(cleanup);

/** A stand-in chunk that registers with the ambient (controller) gate and settles when told. */
function FakeChunk({ settled }: { settled: boolean }) {
  const gate = useCoordinatedGate();
  useSettleGate(settled, gate);
  return <div data-testid="chunk">chunk</div>;
}

function Harness({
  options,
  chunkSettled,
  fireMarkLast = false,
}: {
  options?: UseStreamControllerOptions;
  chunkSettled: boolean[];
  fireMarkLast?: boolean;
}) {
  const { Controller, loading, markLast } = useStreamController(options);
  // The controller owner drives the terminal, mirroring how `useStream` calls
  // `markLast` when its stream ends.
  React.useEffect(() => {
    if (fireMarkLast) {
      markLast();
    }
  }, [fireMarkLast, markLast]);
  return (
    <React.Fragment>
      <div data-testid="status">{loading ? 'loading' : 'done'}</div>
      <Controller>
        {chunkSettled.map((settled, index) => (
          <FakeChunk key={index} settled={settled} />
        ))}
      </Controller>
    </React.Fragment>
  );
}

function status(): string | null {
  return screen.getByTestId('status').textContent;
}

describe('useStreamController', () => {
  it('reports loading while chunks are pending and done once they all settle', async () => {
    const { rerender } = render(<Harness chunkSettled={[false, false]} />);
    expect(status()).toBe('loading');

    rerender(<Harness chunkSettled={[true, true]} />);
    await waitFor(() => expect(status()).toBe('done'));
  });

  it('is done immediately when there are no chunks', async () => {
    render(<Harness chunkSettled={[]} />);
    await waitFor(() => expect(status()).toBe('done'));
  });

  it('with knownCount, holds until the expected number of chunks has registered', async () => {
    const options = { knownCount: 2 };
    const { rerender } = render(<Harness options={options} chunkSettled={[true]} />);
    // One of two registered (and settled), but the count isn't met yet.
    await waitFor(() => expect(status()).toBe('loading'));

    rerender(<Harness options={options} chunkSettled={[true, true]} />);
    await waitFor(() => expect(status()).toBe('done'));
  });

  it('with streaming, holds until markLast even after every present chunk settles', async () => {
    const options = { streaming: true };
    const { rerender } = render(<Harness options={options} chunkSettled={[true, true]} />);
    // All present chunks settled, but an unknown-count stream stays open.
    await waitFor(() => expect(status()).toBe('loading'));

    rerender(<Harness options={options} chunkSettled={[true, true]} fireMarkLast />);
    await waitFor(() => expect(status()).toBe('done'));
  });
});
