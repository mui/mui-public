/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getTranspile, resetTranspileClientForTests } from './transpileClientSingleton';
import { transformCode } from './transformCode';

/** Minimal in-process `Worker` stand-in (see `createTranspileWorkerClient.test.ts`). */
class FakeWorker {
  static instances: FakeWorker[] = [];

  posted: Array<unknown> = [];

  terminated = false;

  private listeners = new Map<string, Set<(event: Event) => void>>();

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  terminate(): void {
    this.terminated = true;
  }

  private dispatch(type: string, event: Event): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
  }

  respond(data: unknown): void {
    this.dispatch('message', { data } as MessageEvent);
  }

  /** Simulate the worker crashing (an `error` event). */
  crash(message: string): void {
    this.dispatch('error', { message } as ErrorEvent);
  }
}

describe('transpileClientSingleton', () => {
  let originalWorker: typeof Worker | undefined;

  beforeEach(() => {
    FakeWorker.instances = [];
    resetTranspileClientForTests();
    originalWorker = globalThis.Worker;
    (globalThis as { Worker: unknown }).Worker = FakeWorker;
  });

  afterEach(() => {
    resetTranspileClientForTests();
    if (originalWorker) {
      (globalThis as { Worker: unknown }).Worker = originalWorker;
    } else {
      delete (globalThis as { Worker?: unknown }).Worker;
    }
  });

  it('returns a worker-backed transpile when module workers are available', async () => {
    const transpile = await getTranspile();
    expect(FakeWorker.instances).toHaveLength(1);
    const worker = FakeWorker.instances[0];

    const promise = transpile('const x = 1;', { fileName: 'a.ts' });
    const message = worker.posted[0] as { id: number; source: string };
    expect(message.source).toBe('const x = 1;');

    worker.respond({ type: 'transpile', id: message.id, ok: true, code: 'OUT' });
    await expect(promise).resolves.toBe('OUT');
  });

  it('reuses one shared instance across calls', async () => {
    const first = getTranspile();
    const second = getTranspile();
    expect(first).toBe(second); // same cached promise
    await first;
    expect(FakeWorker.instances).toHaveLength(1); // only one worker ever created
  });

  it('falls back to a main-thread transpile when Worker is unavailable', async () => {
    delete (globalThis as { Worker?: unknown }).Worker;

    const transpile = await getTranspile();
    expect(FakeWorker.instances).toHaveLength(0); // never tried to build a worker instance

    const source = 'const x: number = 1;\nexport const y = <div />;';
    await expect(transpile(source)).resolves.toBe(transformCode(source));
  });

  it('self-heals to the main thread when the shared worker crashes mid-session', async () => {
    const transpile = await getTranspile();
    const worker = FakeWorker.instances[0];

    // A request in flight when the worker dies rejects (rather than hanging)...
    const inflight = transpile('const x = 1;').catch((error: Error) => error.message);
    worker.crash('worker exploded');
    await expect(inflight).resolves.toBe('worker exploded');

    // ...but the SAME (stable) transpile now routes to the main thread, so editing
    // keeps working without re-fetching — and no replacement worker is built.
    const source = 'const x: number = 1;\nexport const y = <div />;';
    await expect(transpile(source)).resolves.toBe(transformCode(source));
    expect(FakeWorker.instances).toHaveLength(1);
  });
});
