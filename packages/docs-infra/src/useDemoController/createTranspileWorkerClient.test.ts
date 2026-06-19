/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTranspileWorkerClient } from './createTranspileWorkerClient';

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

describe('createTranspileWorkerClient', () => {
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

  it('throws a tagged error when module workers are unsupported', () => {
    (globalThis as { Worker: unknown }).Worker = class {
      constructor() {
        throw new Error('module workers off');
      }
    };
    expect(() => createTranspileWorkerClient()).toThrow(/Module workers are not supported/);
  });

  it('posts the source + options and resolves with the transpiled code', async () => {
    const client = createTranspileWorkerClient();
    const worker = FakeWorker.instances[0];

    const promise = client.transpile('const x = 1;', { fileName: 'a.ts', nested: false });
    const message = worker.posted[0] as {
      type: string;
      id: number;
      source: string;
      options: unknown;
    };
    expect(message.type).toBe('transpile');
    expect(message.id).toBe(1);
    expect(message.source).toBe('const x = 1;');
    expect(message.options).toEqual({ fileName: 'a.ts', nested: false });

    worker.respond({ type: 'transpile', id: message.id, ok: true, code: 'OUT' });
    await expect(promise).resolves.toBe('OUT');

    client.terminate();
  });

  it('rejects when the worker reports an error', async () => {
    const client = createTranspileWorkerClient();
    const worker = FakeWorker.instances[0];

    const promise = client.transpile('bad(');
    const message = worker.posted[0] as { id: number };
    worker.respond({ type: 'transpile', id: message.id, ok: false, error: 'syntax boom' });

    await expect(promise).rejects.toThrow('syntax boom');
    client.terminate();
  });

  it('demultiplexes concurrent requests by id (resolves out of order)', async () => {
    const client = createTranspileWorkerClient();
    const worker = FakeWorker.instances[0];

    const first = client.transpile('a');
    const second = client.transpile('b');

    const firstMessage = worker.posted[0] as { id: number };
    const secondMessage = worker.posted[1] as { id: number };
    expect(secondMessage.id).toBe(firstMessage.id + 1);

    worker.respond({ type: 'transpile', id: secondMessage.id, ok: true, code: 'B' });
    worker.respond({ type: 'transpile', id: firstMessage.id, ok: true, code: 'A' });

    await expect(first).resolves.toBe('A');
    await expect(second).resolves.toBe('B');
    client.terminate();
  });

  it('rejects with signal.reason when the signal is already aborted', async () => {
    const client = createTranspileWorkerClient();
    const worker = FakeWorker.instances[0];

    const controller = new AbortController();
    controller.abort(new Error('cancelled'));

    await expect(client.transpile('a', {}, controller.signal)).rejects.toThrow('cancelled');
    // No message was posted for the aborted request.
    expect(worker.posted).toHaveLength(0);
    client.terminate();
  });

  it('rejects an in-flight request when the signal aborts and ignores the late response', async () => {
    const client = createTranspileWorkerClient();
    const worker = FakeWorker.instances[0];

    const controller = new AbortController();
    const promise = client.transpile('a', {}, controller.signal);
    const message = worker.posted[0] as { id: number };

    controller.abort(new Error('superseded'));
    await expect(promise).rejects.toThrow('superseded');

    // A late response for the aborted id should not throw or affect anything.
    expect(() =>
      worker.respond({ type: 'transpile', id: message.id, ok: true, code: 'late' }),
    ).not.toThrow();
    client.terminate();
  });

  it('terminate() rejects all pending requests and terminates the worker', async () => {
    const client = createTranspileWorkerClient();
    const worker = FakeWorker.instances[0];

    const first = client.transpile('a');
    const second = client.transpile('b');
    const firstCaught = first.catch((error: Error) => error.message);
    const secondCaught = second.catch((error: Error) => error.message);

    client.terminate();

    expect(worker.terminated).toBe(true);
    await expect(firstCaught).resolves.toBe('Worker terminated');
    await expect(secondCaught).resolves.toBe('Worker terminated');
  });

  it('removes the abort listener after a successful response', async () => {
    const client = createTranspileWorkerClient();
    const worker = FakeWorker.instances[0];

    const controller = new AbortController();
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');

    const promise = client.transpile('a', {}, controller.signal);
    const message = worker.posted[0] as { id: number };
    worker.respond({ type: 'transpile', id: message.id, ok: true, code: 'A' });
    await promise;

    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    client.terminate();
  });
});
