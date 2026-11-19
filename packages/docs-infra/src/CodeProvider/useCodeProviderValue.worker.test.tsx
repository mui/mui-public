/**
 * @vitest-environment jsdom
 *
 * Lazy worker creation: `CodeProviderLazy` must NOT spin up the live-editing
 * worker on mount, and `ensureParseSourceWorker()` must create and initialize it
 * on demand — once, however many blocks ask for it.
 */
import * as React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// eslint-disable-next-line testing-library/no-manual-cleanup -- root vitest config does not set `globals: true`, so RTL's auto cleanup is a no-op here.
import { renderHook, cleanup, waitFor, act } from '@testing-library/react';
import { CodeProviderLazy } from './CodeProviderLazy';
import { useCodeContext } from './CodeContext';

type PostedMessage = { type: string };

/** In-process stand-in for a real module `Worker`. */
class FakeWorker {
  static instances: FakeWorker[] = [];

  posted: PostedMessage[] = [];

  private listeners = new Set<(event: Event) => void>();

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: PostedMessage): void {
    this.posted.push(message);
    // Auto-acknowledge init so the client's promise resolves.
    if (message.type === 'init') {
      queueMicrotask(() => this.respond({ type: 'init-ack' }));
    }
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    // Segregate by event type so the client's `error`/`messageerror` listeners
    // don't receive `message` events (which would spuriously trip the fatal path).
    if (type !== 'message') {
      return;
    }
    this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    if (type !== 'message') {
      return;
    }
    this.listeners.delete(listener);
  }

  terminate(): void {}

  respond(data: unknown): void {
    const event = { data } as MessageEvent;
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }
}

let originalWorker: typeof Worker | undefined;

beforeEach(() => {
  FakeWorker.instances = [];
  originalWorker = globalThis.Worker;
  (globalThis as { Worker: unknown }).Worker = FakeWorker;
});

afterEach(() => {
  cleanup();
  if (originalWorker) {
    (globalThis as { Worker: unknown }).Worker = originalWorker;
  } else {
    delete (globalThis as { Worker?: unknown }).Worker;
  }
});

function renderProviderContext() {
  return renderHook(() => useCodeContext(), {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <CodeProviderLazy>{children}</CodeProviderLazy>
    ),
  });
}

function initMessages(worker: FakeWorker): PostedMessage[] {
  return worker.posted.filter((message) => message.type === 'init');
}

describe('CodeProviderLazy live-editing worker', () => {
  it('does not create a worker on mount', () => {
    renderProviderContext();
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('lazily creates the worker and initializes it', async () => {
    const { result } = renderProviderContext();

    act(() => {
      result.current.ensureParseSourceWorker?.();
    });

    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    await waitFor(() => expect(initMessages(FakeWorker.instances[0])).toHaveLength(1));
  });

  it('reuses the existing worker on later calls', async () => {
    const { result } = renderProviderContext();

    act(() => {
      result.current.ensureParseSourceWorker?.();
    });
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));

    act(() => {
      result.current.ensureParseSourceWorker?.();
    });

    // Give any stray work a tick, then assert the worker was neither recreated
    // nor initialized again.
    await act(async () => {
      await Promise.resolve();
    });
    expect(FakeWorker.instances).toHaveLength(1);
    expect(initMessages(FakeWorker.instances[0])).toHaveLength(1);
  });
});
