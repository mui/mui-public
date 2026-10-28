import type { Root as HastRoot } from 'hast';
import type { createStarryNight } from '@wooorm/starry-night';

type Grammar = Parameters<typeof createStarryNight>[0][number];

/**
 * Asynchronously parses source code into a HAST tree, typically off the main
 * thread (e.g. via a Web Worker). Used during live typing so the UI thread
 * stays responsive. Accepts an `AbortSignal` so a stale request can be
 * cancelled when newer keystrokes arrive.
 *
 * Internal: not exported as part of the public API. Consumers wire up async
 * parsing by passing a worker URL to `CodeProvider`; the produced client
 * exposes a `parseSourceAsync` callable directly without referring to this
 * type.
 */
export type ParseSourceAsync = (
  source: string,
  fileName: string,
  language?: string,
  signal?: AbortSignal,
) => Promise<HastRoot>;

type ParseResponse =
  | { type: 'parse'; id: number; ok: true; hast: HastRoot }
  | { type: 'parse'; id: number; ok: false; error: string }
  | { type: 'init-ack' }
  | { type: 'init-error'; error: string }
  | { type: 'register-ack' }
  | { type: 'register-error'; error: string };

type Pending = {
  resolve: (hast: HastRoot) => void;
  reject: (reason: unknown) => void;
  signal: AbortSignal | undefined;
  onAbort: (() => void) | undefined;
};

export interface ParseSourceWorkerClient {
  /**
   * Send the (heavy) grammar payload to the worker. Idempotent: subsequent
   * calls return the same promise. Must be awaited (or composed via
   * `parseSourceAsync`, which awaits it implicitly) before parse requests
   * will be processed.
   */
  init(grammars: Grammar[]): Promise<void>;
  /**
   * Add more grammars to an already-initialized worker (the per-language path:
   * a block becomes editable in a language the worker wasn't initialized with).
   * Resolves on the worker's `register-ack`. Call after `init()`.
   */
  register(grammars: Grammar[]): Promise<void>;
  /**
   * Async syntax-highlighter that runs inside the worker. Returns the same
   * HAST shape as the sync `parseSource`. If `signal` aborts before the
   * worker responds, the in-flight request is dropped and the promise
   * rejects with `signal.reason`.
   */
  parseSourceAsync: ParseSourceAsync;
  terminate(): void;
}

/**
 * Create a worker-backed `parseSourceAsync` implementation. The caller owns
 * the lifecycle and must invoke `terminate()` on unmount.
 *
 * Each client owns exactly one underlying `Worker`. Concurrent in-flight
 * requests are demuxed by a monotonically increasing `id`.
 *
 * If the worker dies unexpectedly (a load/parse failure, or a message that fails
 * to deserialize), every in-flight parse request and pending `init`/`register`
 * handshake is rejected and the client latches `dead`, so a crash surfaces as a
 * rejected promise (which the consumer already handles like an abort, falling back
 * to the synchronous highlighter) rather than a request that hangs forever.
 */
export function createParseSourceWorkerClient(): ParseSourceWorkerClient {
  // Module workers are required (the worker uses `import` statements). On
  // browsers that expose `Worker` but reject `{ type: 'module' }` (older
  // Safari, some embedded webviews), the constructor throws synchronously.
  // Surface that as a tagged error so callers can fall back cleanly to the
  // main-thread highlighter instead of crashing the provider tree.
  let worker: Worker;
  try {
    worker = new Worker(new URL('./parseSourceWorker', import.meta.url), {
      type: 'module',
    });
  } catch (cause) {
    throw new Error('Module workers are not supported in this environment', { cause });
  }

  const pending = new Map<number, Pending>();
  let nextId = 1;
  let initPromise: Promise<void> | null = null;
  // Latched once the worker dies or is terminated, so later calls reject immediately
  // rather than hanging on a worker that will never respond.
  let dead = false;
  // Reject callbacks for in-flight `init()`/`register()` handshakes, so a worker
  // crash can fail them too (they listen on their own one-shot listeners, not
  // `pending`). Each clears itself on settle.
  const handshakeRejecters = new Set<(reason: unknown) => void>();

  // Reject + forget every in-flight parse request with `reason`, detaching abort
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
  // be deserialized. (A parse that merely fails is reported as an `ok: false`
  // response, so it never reaches here.) Reject everything in flight — parse requests
  // AND pending `init`/`register` handshakes — and latch `dead`; the consumer treats
  // the rejection like an abort and falls back to the synchronous highlighter.
  // Idempotent. (Unlike a crash, a deliberate `terminate()` leaves handshakes alone:
  // the component is unmounting, so a still-pending `init` is simply abandoned.)
  const handleFatal = (error: Error) => {
    if (dead) {
      return;
    }
    dead = true;
    worker.terminate();
    rejectAllPending(error);
    for (const reject of [...handshakeRejecters]) {
      reject(error);
    }
    handshakeRejecters.clear();
  };

  worker.addEventListener('message', (event: MessageEvent<ParseResponse>) => {
    const data = event.data;
    if (
      data.type === 'init-ack' ||
      data.type === 'init-error' ||
      data.type === 'register-ack' ||
      data.type === 'register-error'
    ) {
      // `init()` / `register()` listen for these directly via their own
      // one-shot listeners.
      return;
    }
    if (data.type === 'parse') {
      const entry = pending.get(data.id);
      if (!entry) {
        // Aborted before response arrived — drop silently.
        return;
      }
      pending.delete(data.id);
      if (entry.signal && entry.onAbort) {
        entry.signal.removeEventListener('abort', entry.onAbort);
      }
      if (data.ok) {
        entry.resolve(data.hast);
      } else {
        entry.reject(new Error(data.error));
      }
    }
  });
  worker.addEventListener('error', (event: ErrorEvent) => {
    handleFatal(new Error(event.message || 'Parse worker errored'));
  });
  worker.addEventListener('messageerror', () => {
    handleFatal(new Error('Parse worker received an undeserializable message'));
  });

  function init(grammars: Grammar[]): Promise<void> {
    if (initPromise) {
      return initPromise;
    }
    if (dead) {
      return Promise.reject(new Error('Parse worker is no longer available'));
    }
    initPromise = new Promise<void>((resolve, reject) => {
      const settle = () => {
        handshakeRejecters.delete(reject);
        worker.removeEventListener('message', onMessage);
      };
      function onMessage(event: MessageEvent<ParseResponse>) {
        if (event.data.type === 'init-ack') {
          settle();
          resolve();
        } else if (event.data.type === 'init-error') {
          settle();
          reject(new Error(event.data.error));
        }
      }
      handshakeRejecters.add(reject);
      worker.addEventListener('message', onMessage);
      worker.postMessage({ type: 'init', grammars });
    });
    return initPromise;
  }

  function register(grammars: Grammar[]): Promise<void> {
    if (dead) {
      return Promise.reject(new Error('Parse worker is no longer available'));
    }
    return new Promise<void>((resolve, reject) => {
      const settle = () => {
        handshakeRejecters.delete(reject);
        worker.removeEventListener('message', onMessage);
      };
      function onMessage(event: MessageEvent<ParseResponse>) {
        if (event.data.type === 'register-ack') {
          settle();
          resolve();
        } else if (event.data.type === 'register-error') {
          settle();
          reject(new Error(event.data.error));
        }
      }
      handshakeRejecters.add(reject);
      worker.addEventListener('message', onMessage);
      worker.postMessage({ type: 'register', grammars });
    });
  }

  const parseSourceAsync: ParseSourceAsync = async (source, fileName, language, signal) => {
    if (!initPromise) {
      throw new Error('parseSourceAsync called before init(). Call client.init(grammars) first.');
    }
    if (dead) {
      throw new Error('Parse worker is no longer available');
    }
    if (signal?.aborted) {
      throw signal.reason;
    }
    await initPromise;
    if (dead) {
      throw new Error('Parse worker is no longer available');
    }
    if (signal?.aborted) {
      throw signal.reason;
    }

    const id = nextId;
    nextId += 1;

    return new Promise<HastRoot>((resolve, reject) => {
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

      worker.postMessage({ type: 'parse', id, source, fileName, language });
    });
  };

  function terminate(): void {
    dead = true;
    worker.terminate();
    rejectAllPending(new Error('Worker terminated'));
  }

  return { init, register, parseSourceAsync, terminate };
}
