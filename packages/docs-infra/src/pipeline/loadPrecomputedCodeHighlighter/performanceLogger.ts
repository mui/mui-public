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
