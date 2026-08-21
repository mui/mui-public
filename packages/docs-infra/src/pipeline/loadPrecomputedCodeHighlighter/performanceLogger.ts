export function logPerformance(
  entry: PerformanceEntry,
  notableMs: number,
  showWrapperMeasures: boolean,
  filterContext?: string,
) {
  if (entry.duration < notableMs) {
    return;
  }

  // If filterContext is provided, only log entries that include it
  if (filterContext && !entry.name.includes(filterContext)) {
    return;
  }

  let delim = '-';
  let message = entry.name;
  if (message.startsWith('| ')) {
    if (!showWrapperMeasures) {
      return;
    }

    delim = '|';
    message = message.slice(2);
  }

  const duration = Math.round(entry.duration).toString().padStart(4, ' ');
  console.warn(`${duration}ms ${delim} ${message}`);
}

export function createPerformanceLogger(
  notableMs: number,
  showWrapperMeasures: boolean,
  filterContext?: string,
) {
  const performanceLogger: PerformanceObserverCallback = (list) => {
    for (const entry of list.getEntries()) {
      logPerformance(entry, notableMs, showWrapperMeasures, filterContext);
    }
  };

  return performanceLogger;
}

export function nameMark(functionName: string, event: string, context: string[], wrapper = false) {
  return `${wrapper ? '| ' : ''}${functionName} ${wrapper ? '|' : '-'} ${event} - ${context.join(' - ')}`;
}

/**
 * Helper to create a performance mark and measure in one call.
 *
 * @param startMark - Optional start mark name for the measure (typically currentMark)
 * @param names - Object with mark and measure names
 * @param context - Array of context strings [functionName, ...context]
 * @param wrapper - Whether this is a wrapper measure (uses pipe delimiter)
 * @returns The mark name that was created
 *
 * @example
 * ```ts
 * currentMark = performanceMeasure(
 *   currentMark,
 *   { mark: 'processed', measure: 'processing' },
 *   [functionName, relativePath],
 *   true,
 * );
 * ```
 */
export function performanceMeasure(
  startMark: string | undefined,
  names: { mark: string; measure: string } | { prefix?: string; mark: string; measure: string },
  context: string[],
  wrapper = false,
): string {
  const [functionName, ...restContext] = context;
  const prefix = 'prefix' in names && names.prefix ? `${names.prefix} ` : '';

  const markName = nameMark(functionName, `${prefix}${names.mark}`, restContext, wrapper);
  const measureName = nameMark(functionName, `${prefix}${names.measure}`, restContext, wrapper);

  performance.mark(markName);
  performance.measure(measureName, startMark, markName);

  return markName;
}

// A single process-wide observer shared by every build-time loader.
//
// Loaders run many concurrent instances in one process — the code-highlighter
// loader alone runs once per demo. A per-loader `PerformanceObserver` sees the
// whole global measure timeline, so each instance had to filter to its own
// resource path to avoid logging every other loader's marks N times. That filter
// also dropped the nested pipeline sub-measures (e.g. the `Load Variant File`
// phases), which are keyed by a variant's file URL rather than the loader's path
// — so the detailed breakdown never reached the log. One shared observer logs
// every mark exactly once, letting all loaders' phases surface together.
let sharedObserver: PerformanceObserver | undefined;
let sharedNotableMs = 100;
let sharedShowWrapperMeasures = false;

/**
 * Installs the shared performance observer (once per process) and returns a
 * `flush` callback. Subsequent calls reuse the same observer, so concurrent
 * loaders never compete or double-log.
 *
 * Call the returned `flush()` when a loader completes to synchronously drain and
 * log any buffered measures, so output appears promptly near the work that
 * produced it without each loader owning its own observer. Entries created after
 * a flush are still delivered asynchronously by the shared observer.
 *
 * @returns A flush callback that logs any buffered measures synchronously.
 */
export function ensurePerformanceLogger(
  notableMs: number,
  showWrapperMeasures: boolean,
): () => void {
  sharedNotableMs = notableMs;
  sharedShowWrapperMeasures = showWrapperMeasures;

  if (!sharedObserver) {
    sharedObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        logPerformance(entry, sharedNotableMs, sharedShowWrapperMeasures);
      }
    });
    sharedObserver.observe({ entryTypes: ['measure'] });
  }

  const observer = sharedObserver;
  return () => {
    observer
      .takeRecords()
      .forEach((entry) => logPerformance(entry, sharedNotableMs, sharedShowWrapperMeasures));
  };
}

/**
 * Disconnects and clears the shared performance observer. Intended for tests
 * that need a clean observer between cases.
 */
export function resetPerformanceLogger(): void {
  sharedObserver?.disconnect();
  sharedObserver = undefined;
}
