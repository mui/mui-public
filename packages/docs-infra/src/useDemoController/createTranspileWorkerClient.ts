import type { Transpile, TranspileSourceOptions } from './transpileSource';

type TranspileResponse =
  | { type: 'transpile'; id: number; ok: true; code: string }
  | { type: 'transpile'; id: number; ok: false; error: unknown };

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
 * If the worker dies unexpectedly (a load/parse failure, or a message that fails
 * to deserialize), every in-flight request is rejected and `onFatal` fires — so a
 * crash surfaces as a rejected build rather than a request that hangs forever. The
 * client then latches `dead`: later `transpile` calls reject immediately instead of
 * posting to a worker that will never reply. The owner (`transpileClientSingleton`)
 * uses `onFatal` to swap in the main-thread transpile so editing keeps working.
 *
 * Mirrors `CodeProvider/createParseSourceWorkerClient` — minus the grammar
 * init/register handshake, since transpilation is stateless.
 */
export function createTranspileWorkerClient(
  onFatal?: (error: Error) => void,
): TranspileWorkerClient {
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
  // Latched once the worker dies or is terminated, so later `transpile` calls reject
  // immediately rather than hanging on a worker that will never respond.
  let dead = false;

  // Reject + forget every in-flight request with `reason`, detaching their abort
  // listeners first. Shared by `terminate()` (intentional) and the fatal-error path.
  const rejectAllPending = (reason: unknown) => {
    for (const entry of pending.values()) {
      if (entry.signal && entry.onAbort) {
        entry.signal.removeEventListener('abort', entry.onAbort);
      }
      entry.reject(reason);
    }
    pending.clear();
  };

  // The worker died unexpectedly — a load/parse failure, or a message that could not
  // be deserialized. (A transpile that merely throws is caught inside the worker and
  // reported as an `ok: false` response, so it never reaches here.) Reject everything
  // in flight, latch `dead`, terminate the husk, and let the owner recover via
  // `onFatal`. Idempotent: a second fatal event (or a later `terminate`) is a no-op.
  const handleFatal = (error: Error) => {
    if (dead) {
      return;
    }
    dead = true;
    rejectAllPending(error);
    worker.terminate();
    onFatal?.(error);
  };

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
      entry.reject(data.error);
    }
  });
  worker.addEventListener('error', (event: ErrorEvent) => {
    handleFatal(new Error(event.message || 'Transpile worker errored'));
  });
  worker.addEventListener('messageerror', () => {
    handleFatal(new Error('Transpile worker received an undeserializable message'));
  });

  const transpile: Transpile = (source, options, signal) => {
    if (dead) {
      return Promise.reject(new Error('Transpile worker is no longer available'));
    }
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
    dead = true;
    worker.terminate();
    rejectAllPending(new Error('Worker terminated'));
  }

  return { transpile, terminate };
}
