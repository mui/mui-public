/**
 * Process-wide concurrency limiter for source transforms.
 *
 * `SourceTransformers` such as `TypescriptToJavascriptTransformer` parse and
 * rewrite each input and can allocate large intermediate strings. When a
 * Next.js production build fans out across many webpack workers, and each
 * worker concurrently transforms every dependency of every variant, peak heap
 * usage can exceed `--max-old-space-size`.
 *
 * This module exposes a per-process gate that callers can configure with
 * `setTransformConcurrency(limit)` (typically once per webpack worker). The
 * default is `Infinity`, preserving the original unbounded behavior so
 * isomorphic callers (browser, tests) are unaffected.
 */

let limit = Number.POSITIVE_INFINITY;
let active = 0;
const queue: Array<() => void> = [];

/**
 * Set the maximum number of `runTransform` callbacks allowed to run
 * concurrently in this process.
 *
 * Pass a positive finite number to enforce a limit, or `Infinity` to disable
 * limiting. Calls already in flight are not interrupted; queued callbacks are
 * released as soon as the new limit allows.
 */
export function setTransformConcurrency(nextLimit: number): void {
  if (!Number.isFinite(nextLimit)) {
    limit = Number.POSITIVE_INFINITY;
  } else if (nextLimit < 1) {
    limit = 1;
  } else {
    limit = Math.floor(nextLimit);
  }
  drain();
}

function drain(): void {
  while (active < limit && queue.length > 0) {
    const next = queue.shift();
    if (next) {
      active += 1;
      next();
    }
  }
}

/**
 * Run `fn` while respecting the process-wide transform concurrency limit.
 * The returned promise resolves with `fn`'s value (or rejects with its error).
 */
export function runTransform<T>(fn: () => Promise<T>): Promise<T> {
  if (active < limit) {
    active += 1;
    return invoke(fn);
  }

  return new Promise<T>((resolve, reject) => {
    queue.push(() => {
      invoke(fn).then(resolve, reject);
    });
  });
}

function invoke<T>(fn: () => Promise<T>): Promise<T> {
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      active -= 1;
      drain();
    });
}
