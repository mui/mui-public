export function logPerformance(
  entry: PerformanceEntry,
  notableMs: number,
  showWrapperMeasures: boolean,
) {
  if (entry.duration < notableMs) {
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

export function createPerformanceLogger(notableMs: number, showWrapperMeasures: boolean) {
  const performanceLogger: PerformanceObserverCallback = (list) => {
    for (const entry of list.getEntries()) {
      logPerformance(entry, notableMs, showWrapperMeasures);
    }
  };

  return performanceLogger;
}

export function nameMark(functionName: string, event: string, context: string[], wrapper = false) {
  return `${wrapper ? '| ' : ''}${functionName} ${wrapper ? '|' : '-'} ${event} - ${context.join(' - ')}`;
}
