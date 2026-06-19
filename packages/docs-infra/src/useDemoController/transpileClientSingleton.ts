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

async function createTranspile(): Promise<Transpile> {
  // A browser with module-worker support runs transpilation off the UI thread.
  // Anything else (SSR, no `Worker`, older Safari that rejects module workers)
  // falls back to a main-thread transpile — still async, so the caller has one
  // code path. The heavy `transpileSource` (sucrase + the import parser) is loaded
  // only on that fallback, so it never enters the main bundle when a worker exists.
  try {
    const { createTranspileWorkerClient } = await import('./createTranspileWorkerClient');
    const client = createTranspileWorkerClient();
    activeClient = client;
    return client.transpile;
  } catch {
    const { transpileSource } = await import('./transpileSource');
    // `async` so a transpile failure rejects (matching the worker client) rather
    // than throwing synchronously.
    return async (source, options) => transpileSource(source, options);
  }
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
