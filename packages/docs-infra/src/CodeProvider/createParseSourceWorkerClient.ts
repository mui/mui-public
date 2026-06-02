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

  function init(grammars: Grammar[]): Promise<void> {
    if (initPromise) {
      return initPromise;
    }
    initPromise = new Promise<void>((resolve, reject) => {
      const onMessage = (event: MessageEvent<ParseResponse>) => {
        if (event.data.type === 'init-ack') {
          worker.removeEventListener('message', onMessage);
          resolve();
        } else if (event.data.type === 'init-error') {
          worker.removeEventListener('message', onMessage);
          reject(new Error(event.data.error));
        }
      };
      worker.addEventListener('message', onMessage);
      worker.postMessage({ type: 'init', grammars });
    });
    return initPromise;
  }

  function register(grammars: Grammar[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onMessage = (event: MessageEvent<ParseResponse>) => {
        if (event.data.type === 'register-ack') {
          worker.removeEventListener('message', onMessage);
          resolve();
        } else if (event.data.type === 'register-error') {
          worker.removeEventListener('message', onMessage);
          reject(new Error(event.data.error));
        }
      };
      worker.addEventListener('message', onMessage);
      worker.postMessage({ type: 'register', grammars });
    });
  }

  const parseSourceAsync: ParseSourceAsync = async (source, fileName, language, signal) => {
    if (!initPromise) {
      throw new Error('parseSourceAsync called before init(). Call client.init(grammars) first.');
    }
    if (signal?.aborted) {
      throw signal.reason;
    }
    await initPromise;
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
    worker.terminate();
    for (const entry of pending.values()) {
      if (entry.signal && entry.onAbort) {
        entry.signal.removeEventListener('abort', entry.onAbort);
      }
      entry.reject(new Error('Worker terminated'));
    }
    pending.clear();
  }

  return { init, register, parseSourceAsync, terminate };
}
