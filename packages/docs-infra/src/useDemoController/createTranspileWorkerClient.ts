import type { Transpile, TranspileSourceOptions } from './transpileSource';

type TranspileResponse =
  | { type: 'transpile'; id: number; ok: true; code: string }
  | { type: 'transpile'; id: number; ok: false; error: string };

type Pending = {
  resolve: (code: string) => void;
  reject: (reason: unknown) => void;
  signal: AbortSignal | undefined;
  onAbort: (() => void) | undefined;
};

export interface TranspileWorkerClient {
  /**
   * Transpiles one source inside the worker. Returns the same string the
   * synchronous `transpileSource` would. If `signal` aborts before the worker
   * responds, the in-flight request is dropped and the promise rejects with
   * `signal.reason`.
   */
  transpile: Transpile;
  terminate(): void;
}

/**
 * Creates a worker-backed {@link Transpile}. The caller owns the lifecycle and
 * must call `terminate()` when done. Each client owns exactly one `Worker`;
 * concurrent in-flight requests are demuxed by a monotonically increasing `id`.
 *
 * Mirrors `CodeProvider/createParseSourceWorkerClient` — minus the grammar
 * init/register handshake, since transpilation is stateless.
 */
export function createTranspileWorkerClient(): TranspileWorkerClient {
  // Module workers are required (the worker uses `import` statements). On browsers
  // that expose `Worker` but reject `{ type: 'module' }` (older Safari, some
  // embedded webviews) the constructor throws synchronously. Surface that as a
  // tagged error so callers can fall back cleanly to the main-thread transpile.
  let worker: Worker;
  try {
    worker = new Worker(new URL('./transpileWorker', import.meta.url), { type: 'module' });
  } catch (cause) {
    throw new Error('Module workers are not supported in this environment', { cause });
  }

  const pending = new Map<number, Pending>();
  let nextId = 1;

  worker.addEventListener('message', (event: MessageEvent<TranspileResponse>) => {
    const data = event.data;
    if (data.type !== 'transpile') {
      return;
    }
    const entry = pending.get(data.id);
    if (!entry) {
      // Aborted before the response arrived — drop silently.
      return;
    }
    pending.delete(data.id);
    if (entry.signal && entry.onAbort) {
      entry.signal.removeEventListener('abort', entry.onAbort);
    }
    if (data.ok) {
      entry.resolve(data.code);
    } else {
      entry.reject(new Error(data.error));
    }
  });

  const transpile: Transpile = (source, options, signal) => {
    if (signal?.aborted) {
      return Promise.reject(signal.reason);
    }

    const id = nextId;
    nextId += 1;

    return new Promise<string>((resolve, reject) => {
      const onAbort = signal
        ? () => {
            const entry = pending.get(id);
            if (!entry) {
              return;
            }
            pending.delete(id);
            if (entry.signal && entry.onAbort) {
              entry.signal.removeEventListener('abort', entry.onAbort);
            }
            reject(signal.reason);
          }
        : undefined;

      pending.set(id, { resolve, reject, signal, onAbort });
      if (signal && onAbort) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      const message: {
        type: 'transpile';
        id: number;
        source: string;
        options?: TranspileSourceOptions;
      } = { type: 'transpile', id, source, options };
      worker.postMessage(message);
    });
  };

  function terminate(): void {
    worker.terminate();
    for (const entry of pending.values()) {
      if (entry.signal && entry.onAbort) {
        entry.signal.removeEventListener('abort', entry.onAbort);
      }
      entry.reject(new Error('Worker terminated'));
    }
    pending.clear();
  }

  return { transpile, terminate };
}
