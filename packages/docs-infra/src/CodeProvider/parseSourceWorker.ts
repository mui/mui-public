/**
 * Worker entry point for off-main-thread syntax highlighting.
 *
 * Lifecycle:
 *  1. Main thread posts `{ type: 'init', grammars }` once. The worker calls
 *     `createStarryNight(grammars)` and primes the singleton used by
 *     `parseSource`. Posts `{ type: 'init-ack' }` when ready.
 *  2. For each parse request, main thread posts
 *     `{ type: 'parse', id, source, fileName, language? }`. The worker runs
 *     the same sync `parseSource` body that the main thread uses (so the HAST
 *     output is byte-identical) and posts `{ type: 'parse', id, ok, hast? , error? }`.
 *
 * Parse requests that arrive before init completes are queued and drained on
 * `init-ack`. The worker does not import `./grammars` statically — the heavy
 * grammar JSON payload travels across the boundary exactly once via the init
 * message so that the (lazy) main-thread grammar chunk is the single shared
 * source of truth.
 */

import { createStarryNight } from '@wooorm/starry-night';
import { parseSource } from '../pipeline/parseSource/parseSource';

type Grammar = Parameters<typeof createStarryNight>[0][number];

const STARRY_NIGHT_KEY = '__docs_infra_starry_night_instance__';

type ParseRequest = {
  type: 'parse';
  id: number;
  source: string;
  fileName: string;
  language?: string;
};

type InitRequest = {
  type: 'init';
  grammars: Grammar[];
};

type RegisterRequest = {
  type: 'register';
  grammars: Grammar[];
};

type IncomingMessage = InitRequest | RegisterRequest | ParseRequest;

// `self` in a dedicated worker exposes `postMessage`/`addEventListener` on the
// global scope, but the default `tsconfig` `lib` here doesn't include the
// `webworker` lib so we cast once via a typed alias instead of per-call.
const workerScope = self as unknown as Worker;

const queue: ParseRequest[] = [];
let initialized = false;
let initInFlight: Promise<void> | null = null;

async function init(grammars: Grammar[]): Promise<void> {
  if (initInFlight) {
    return initInFlight;
  }
  initInFlight = (async () => {
    try {
      const starryNight = await createStarryNight(grammars);
      (globalThis as { [key: string]: unknown })[STARRY_NIGHT_KEY] = starryNight;
      initialized = true;
      // Drain queued parse requests in arrival order.
      for (const req of queue.splice(0)) {
        runParse(req);
      }
      workerScope.postMessage({ type: 'init-ack' });
    } catch (error) {
      // Surface init failures to the client so `parseSourceAsync` can fail
      // fast instead of hanging on an unresolved init promise.
      const message = error instanceof Error ? error.message : String(error);
      workerScope.postMessage({ type: 'init-error', error: message });
      throw error;
    }
  })();
  return initInFlight;
}

async function registerGrammars(grammars: Grammar[]): Promise<void> {
  // Wait for init to finish (the client always inits before registering), then
  // add the new grammars to the existing instance.
  if (initInFlight) {
    await initInFlight;
  }
  try {
    const starryNight = (globalThis as { [key: string]: unknown })[STARRY_NIGHT_KEY] as
      { register: (grammars: Grammar[]) => Promise<undefined> } | undefined;
    if (!starryNight) {
      workerScope.postMessage({ type: 'register-error', error: 'worker not initialized' });
      return;
    }
    await starryNight.register(grammars);
    workerScope.postMessage({ type: 'register-ack' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    workerScope.postMessage({ type: 'register-error', error: message });
  }
}

function runParse(req: ParseRequest): void {
  try {
    const hast = parseSource(req.source, req.fileName, req.language);
    workerScope.postMessage({
      type: 'parse',
      id: req.id,
      ok: true,
      hast,
    });
  } catch (error) {
    workerScope.postMessage({
      type: 'parse',
      id: req.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

workerScope.addEventListener('message', (event: MessageEvent<IncomingMessage>) => {
  const data = event.data;
  if (data.type === 'init') {
    // The promise rejection is observed by the client via `init-error`; the
    // local `.catch` here just prevents an unhandled rejection in the worker.
    init(data.grammars).catch(() => {});
    return;
  }
  if (data.type === 'register') {
    // Failures are reported to the client via `register-error`; the `.catch`
    // just prevents an unhandled rejection in the worker.
    registerGrammars(data.grammars).catch(() => {});
    return;
  }
  if (data.type === 'parse') {
    if (initialized) {
      runParse(data);
    } else {
      queue.push(data);
    }
  }
});
