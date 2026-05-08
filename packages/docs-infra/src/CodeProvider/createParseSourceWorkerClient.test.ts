/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Root as HastRoot } from 'hast';
import { createParseSourceWorkerClient } from './createParseSourceWorkerClient';

/**
 * In-process stand-in for a real `Worker`. The test drives it from the main
 * thread by calling `instance.respond(...)` to simulate messages coming back
 * from the worker.
 */
class FakeWorker {
  static instances: FakeWorker[] = [];

  posted: Array<unknown> = [];

  terminated = false;

  private listeners = new Set<(event: MessageEvent) => void>();

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: (event: MessageEvent) => void): void {
    this.listeners.delete(listener);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Simulate a message arriving from the worker. */
  respond(data: unknown): void {
    const event = { data } as MessageEvent;
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }
}

const sampleHast: HastRoot = { type: 'root', children: [] };

describe('createParseSourceWorkerClient', () => {
  let originalWorker: typeof Worker | undefined;

  beforeEach(() => {
    FakeWorker.instances = [];
    originalWorker = globalThis.Worker;
    (globalThis as { Worker: unknown }).Worker = FakeWorker;
  });

  afterEach(() => {
    if (originalWorker) {
      (globalThis as { Worker: unknown }).Worker = originalWorker;
    } else {
      delete (globalThis as { Worker?: unknown }).Worker;
    }
  });

  it('throws when parseSourceAsync is called before init()', async () => {
    const client = createParseSourceWorkerClient();
    await expect(client.parseSourceAsync('a', 'a.ts')).rejects.toThrow(/before init\(\)/);
    client.terminate();
  });

  it('posts the init payload and resolves init() on init-ack', async () => {
    const client = createParseSourceWorkerClient();
    const initPromise = client.init([]);
    const worker = FakeWorker.instances[0];

    expect(worker.posted).toEqual([{ type: 'init', grammars: [] }]);

    worker.respond({ type: 'init-ack' });
    await expect(initPromise).resolves.toBeUndefined();

    client.terminate();
  });

  it('returns the same promise from repeated init() calls', () => {
    const client = createParseSourceWorkerClient();
    const a = client.init([]);
    const b = client.init([]);
    expect(a).toBe(b);
    // Only one `init` message posted.
    expect(FakeWorker.instances[0].posted).toHaveLength(1);
    client.terminate();
  });

  it('rejects init() when the worker reports init-error', async () => {
    const client = createParseSourceWorkerClient();
    const initPromise = client.init([]);
    const worker = FakeWorker.instances[0];

    worker.respond({ type: 'init-error', error: 'grammar boom' });

    await expect(initPromise).rejects.toThrow('grammar boom');
    client.terminate();
  });

  it('parses a request and resolves with the returned HAST', async () => {
    const client = createParseSourceWorkerClient();
    const initPromise = client.init([]);
    const worker = FakeWorker.instances[0];
    worker.respond({ type: 'init-ack' });
    await initPromise;

    const parsePromise = client.parseSourceAsync('hello', 'a.ts', 'ts');
    // `parseSourceAsync` awaits `initPromise` internally; flush microtasks
    // so the parse `postMessage` has run before we inspect `worker.posted`.
    await Promise.resolve();

    // The init message was first; the parse message follows it.
    const parseMessage = worker.posted[1] as { type: string; id: number };
    expect(parseMessage.type).toBe('parse');
    expect(parseMessage.id).toBe(1);

    worker.respond({ type: 'parse', id: parseMessage.id, ok: true, hast: sampleHast });
    await expect(parsePromise).resolves.toBe(sampleHast);

    client.terminate();
  });

  it('rejects when the worker reports a parse error', async () => {
    const client = createParseSourceWorkerClient();
    const initPromise = client.init([]);
    const worker = FakeWorker.instances[0];
    worker.respond({ type: 'init-ack' });
    await initPromise;

    const parsePromise = client.parseSourceAsync('hello', 'a.ts');
    await Promise.resolve();
    const parseMessage = worker.posted[1] as { id: number };
    worker.respond({ type: 'parse', id: parseMessage.id, ok: false, error: 'unknown grammar' });

    await expect(parsePromise).rejects.toThrow('unknown grammar');
    client.terminate();
  });

  it('demultiplexes concurrent requests by id', async () => {
    const client = createParseSourceWorkerClient();
    const initPromise = client.init([]);
    const worker = FakeWorker.instances[0];
    worker.respond({ type: 'init-ack' });
    await initPromise;

    const first = client.parseSourceAsync('a', 'a.ts');
    const second = client.parseSourceAsync('b', 'b.ts');
    await Promise.resolve();

    const firstMessage = worker.posted[1] as { id: number };
    const secondMessage = worker.posted[2] as { id: number };
    expect(secondMessage.id).toBe(firstMessage.id + 1);

    const otherHast: HastRoot = { type: 'root', children: [{ type: 'text', value: 'b' }] };

    // Resolve out of order.
    worker.respond({ type: 'parse', id: secondMessage.id, ok: true, hast: otherHast });
    worker.respond({ type: 'parse', id: firstMessage.id, ok: true, hast: sampleHast });

    await expect(first).resolves.toBe(sampleHast);
    await expect(second).resolves.toBe(otherHast);

    client.terminate();
  });

  it('rejects with signal.reason when the signal is already aborted', async () => {
    const client = createParseSourceWorkerClient();
    const initPromise = client.init([]);
    const worker = FakeWorker.instances[0];
    worker.respond({ type: 'init-ack' });
    await initPromise;

    const controller = new AbortController();
    controller.abort(new Error('cancelled'));

    await expect(
      client.parseSourceAsync('a', 'a.ts', undefined, controller.signal),
    ).rejects.toThrow('cancelled');

    // No parse message was posted.
    expect(worker.posted.filter((m) => (m as { type: string }).type === 'parse')).toHaveLength(0);

    client.terminate();
  });

  it('rejects in-flight requests when the signal aborts and ignores the late response', async () => {
    const client = createParseSourceWorkerClient();
    const initPromise = client.init([]);
    const worker = FakeWorker.instances[0];
    worker.respond({ type: 'init-ack' });
    await initPromise;

    const controller = new AbortController();
    const parsePromise = client.parseSourceAsync('a', 'a.ts', undefined, controller.signal);
    await Promise.resolve();
    const parseMessage = worker.posted[1] as { id: number };

    controller.abort(new Error('superseded'));
    await expect(parsePromise).rejects.toThrow('superseded');

    // A late response for the aborted id should not throw or affect anything.
    expect(() =>
      worker.respond({ type: 'parse', id: parseMessage.id, ok: true, hast: sampleHast }),
    ).not.toThrow();

    client.terminate();
  });

  it('terminate() rejects all pending requests and terminates the worker', async () => {
    const client = createParseSourceWorkerClient();
    const initPromise = client.init([]);
    const worker = FakeWorker.instances[0];
    worker.respond({ type: 'init-ack' });
    await initPromise;

    const first = client.parseSourceAsync('a', 'a.ts');
    const second = client.parseSourceAsync('b', 'b.ts');
    await Promise.resolve();

    // Catch attached eagerly to avoid unhandled-rejection warnings.
    const firstCaught = first.catch((error: Error) => error.message);
    const secondCaught = second.catch((error: Error) => error.message);

    client.terminate();

    expect(worker.terminated).toBe(true);
    await expect(firstCaught).resolves.toBe('Worker terminated');
    await expect(secondCaught).resolves.toBe('Worker terminated');
  });

  it('removes the abort listener after a successful response', async () => {
    const client = createParseSourceWorkerClient();
    const initPromise = client.init([]);
    const worker = FakeWorker.instances[0];
    worker.respond({ type: 'init-ack' });
    await initPromise;

    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');

    const parsePromise = client.parseSourceAsync('a', 'a.ts', undefined, controller.signal);
    await Promise.resolve();
    const parseMessage = worker.posted[1] as { id: number };
    worker.respond({ type: 'parse', id: parseMessage.id, ok: true, hast: sampleHast });
    await parsePromise;

    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));

    client.terminate();
  });
});
