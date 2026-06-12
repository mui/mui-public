/**
 * @vitest-environment jsdom
 *
 * Lazy, per-language worker creation: `CodeProviderLazy` must NOT spin up the
 * live-editing worker on mount, and `ensureParseSourceWorker(scopes)` must create
 * it on demand, initialized with only those scopes' grammars — then `register`
 * additional scopes onto the same worker.
 */
import * as React from 'react';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// eslint-disable-next-line testing-library/no-manual-cleanup -- root vitest config does not set `globals: true`, so RTL's auto cleanup is a no-op here.
import { renderHook, cleanup, waitFor, act } from '@testing-library/react';
import { CodeProviderLazy } from './CodeProviderLazy';
import { useCodeContext } from './CodeContext';

type PostedMessage = { type: string; grammars?: Array<{ scopeName: string }> };

/** In-process stand-in for a real module `Worker`. */
class FakeWorker {
  static instances: FakeWorker[] = [];

  posted: PostedMessage[] = [];

  private listeners = new Set<(event: MessageEvent) => void>();

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: PostedMessage): void {
    this.posted.push(message);
    // Auto-acknowledge init/register so the client's promises resolve.
    if (message.type === 'init') {
      queueMicrotask(() => this.respond({ type: 'init-ack' }));
    } else if (message.type === 'register') {
      queueMicrotask(() => this.respond({ type: 'register-ack' }));
    }
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: (event: MessageEvent) => void): void {
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

function initGrammarScopes(worker: FakeWorker): string[] {
  const init = worker.posted.find((message) => message.type === 'init');
  return (init?.grammars ?? []).map((grammar) => grammar.scopeName);
}

describe('CodeProviderLazy live-editing worker', () => {
  it('does not create a worker on mount', () => {
    renderProviderContext();
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('lazily creates the worker and inits it with only the requested scopes', async () => {
    const { result } = renderProviderContext();

    act(() => {
      result.current.ensureParseSourceWorker?.(['source.css']);
    });

    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    await waitFor(() => expect(initGrammarScopes(FakeWorker.instances[0])).toEqual(['source.css']));
  });

  it('registers additional scopes onto the existing worker without recreating it', async () => {
    const { result } = renderProviderContext();

    act(() => {
      result.current.ensureParseSourceWorker?.(['source.css']);
    });
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    await waitFor(() => expect(initGrammarScopes(FakeWorker.instances[0])).toEqual(['source.css']));

    act(() => {
      result.current.ensureParseSourceWorker?.(['source.tsx']);
    });

    const worker = FakeWorker.instances[0];
    await waitFor(() => {
      const register = worker.posted.find((message) => message.type === 'register');
      expect((register?.grammars ?? []).map((grammar) => grammar.scopeName)).toEqual([
        'source.tsx',
      ]);
    });
    // Still a single worker — no recreation.
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('does nothing when every requested scope was already sent', async () => {
    const { result } = renderProviderContext();

    act(() => {
      result.current.ensureParseSourceWorker?.(['source.css']);
    });
    await waitFor(() => expect(FakeWorker.instances).toHaveLength(1));

    act(() => {
      result.current.ensureParseSourceWorker?.(['source.css']);
    });

    const worker = FakeWorker.instances[0];
    // Give any stray work a tick, then assert no register was posted.
    await act(async () => {
      await Promise.resolve();
    });
    expect(worker.posted.some((message) => message.type === 'register')).toBe(false);
  });
});
