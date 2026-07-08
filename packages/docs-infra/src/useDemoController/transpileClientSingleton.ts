import { createTranspileWorkerClient } from './createTranspileWorkerClient';
import type { Transpile } from './transpileSource';

/**
 * The page-shared transpile, created lazily once and reused across every demo
 * controller. Transpilation is stateless (sucrase is pure), so — unlike the
 * per-provider syntax-highlight worker — a single worker serves the whole page:
 * fewer worker spin-ups, one shared module-graph, and a process-wide compile
 * cache. It is intentionally never terminated; an idle worker is cheap.
 */
let transpilePromise: Promise<Transpile> | null = null;
let activeClient: { terminate(): void } | null = null;

/**
 * Lazily loads the main-thread transpile. The heavy `transpileSource` (sucrase + the
 * import parser) rides in its own chunk, fetched only when there's no worker — so a
 * worker-capable environment never downloads it.
 */
async function loadMainThreadTranspile(): Promise<Transpile> {
  const { transpileSource } = await import('./transpileSource');
  // `async` so a transpile failure rejects (matching the worker client) rather than
  // throwing synchronously.
  return async (source, options, signal) => {
    if (signal?.aborted) {
      throw signal.reason;
    }
    try {
      return transpileSource(source, options);
    } catch (error) {
      // Mirror the worker client: re-wrap so the reported message keeps the error
      // NAME (e.g. `SyntaxError:`), which the worker carries via `toString()` across
      // `postMessage`. Keeps both transpile paths reporting an identical message.
      throw error instanceof Error ? new Error(error.toString()) : error;
    }
  };
}

async function createTranspile(): Promise<Transpile> {
  // The live transpile implementation — a worker, or the main-thread fallback. Held
  // in a closure variable so a worker crash can swap it WITHOUT the caller (which
  // caches the returned function) having to re-fetch.
  let delegate: Transpile;

  const fallBackToMainThread = () => {
    // The same worker URL would just fail again, so don't rebuild it — load the
    // main-thread transpile once and route every later call through it. Until it
    // resolves, calls await the same promise so none are dropped.
    const mainThread = loadMainThreadTranspile();
    delegate = (source, options, signal) => mainThread.then((run) => run(source, options, signal));
  };

  // A browser with module-worker support runs transpilation off the UI thread.
  // `createTranspileWorkerClient()` throws synchronously where module workers are
  // unsupported (SSR, no `Worker`, older Safari) — caught here to fall back to a
  // main-thread transpile, still async so the caller has one code path.
  try {
    const client = createTranspileWorkerClient(() => {
      // The shared worker died (a load/init failure). Its in-flight requests were
      // already rejected by the client (they retry from the next edit); swap to the
      // main thread so live editing keeps working instead of failing every build.
      activeClient = null;
      fallBackToMainThread();
    });
    activeClient = client;
    delegate = client.transpile;
  } catch {
    fallBackToMainThread();
  }

  // A STABLE wrapper: callers cache it, and `delegate` swaps underneath on a crash.
  return (source, options, signal) => delegate(source, options, signal);
}

/**
 * Returns the page-shared {@link Transpile}, creating the worker (or main-thread
 * fallback) on first call and reusing it thereafter. Call this from a browser
 * effect — never at module top level — so the worker is never constructed during
 * SSR.
 */
export function getTranspile(): Promise<Transpile> {
  if (!transpilePromise) {
    transpilePromise = createTranspile();
  }
  return transpilePromise;
}

/** Test-only: drop the cached singleton (and terminate any worker it created). */
export function resetTranspileClientForTests(): void {
  activeClient?.terminate();
  activeClient = null;
  transpilePromise = null;
}
