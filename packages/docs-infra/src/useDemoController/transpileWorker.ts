/**
 * Worker entry point for off-main-thread transpilation.
 *
 * For each request the main thread posts `{ type: 'transpile', id, source,
 * options }`; the worker runs the same {@link transpileSource} body the main
 * thread would (so the output is byte-identical) and posts back
 * `{ type: 'transpile', id, ok, code? | error? }`.
 *
 * Stateless and dependency-free of any handshake: sucrase is pure, so — unlike
 * the syntax-highlight worker — there is no `init`/grammar payload and no request
 * queue. The heavy `sucrase` (and the import parser) are imported here, inside the
 * worker chunk, so they stay off the main thread's bundle.
 */

import { transpileSource, type TranspileSourceOptions } from './transpileSource';

type TranspileRequest = {
  type: 'transpile';
  id: number;
  source: string;
  options?: TranspileSourceOptions;
};

// `self` in a dedicated worker exposes `postMessage`/`addEventListener` on the
// global scope, but the default `tsconfig` `lib` here doesn't include the
// `webworker` lib so we cast once via a typed alias instead of per-call.
const workerScope = self as unknown as Worker;

workerScope.addEventListener('message', (event: MessageEvent<TranspileRequest>) => {
  const data = event.data;
  if (data.type !== 'transpile') {
    return;
  }
  try {
    const code = transpileSource(data.source, data.options);
    workerScope.postMessage({ type: 'transpile', id: data.id, ok: true, code });
  } catch (error) {
    workerScope.postMessage({
      type: 'transpile',
      id: data.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
