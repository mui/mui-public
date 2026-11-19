export interface Timing {
  medianMs: number;
  iterations: number;
}

/** Runs `task` repeatedly after a warm-up and returns the median duration. */
export function measure(task: () => void, budgetMs = 400, minIterations = 5): Timing {
  for (let index = 0; index < 3; index += 1) {
    task();
  }
  const durations: number[] = [];
  const start = performance.now();
  while (durations.length < minIterations || performance.now() - start < budgetMs) {
    const before = performance.now();
    task();
    durations.push(performance.now() - before);
    if (durations.length >= 2000) {
      break;
    }
  }
  durations.sort((left, right) => left - right);
  return { medianMs: durations[Math.floor(durations.length / 2)], iterations: durations.length };
}

export function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}
