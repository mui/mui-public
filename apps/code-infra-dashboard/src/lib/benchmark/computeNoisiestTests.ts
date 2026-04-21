import type { BenchmarkReport } from './types';

export interface NoisyTestRow {
  name: string;
  runs: number;
  mean: number;
  stdDev: number;
  cv: number;
}

const MIN_SAMPLES = 3;

/**
 * Rank tests across the provided reports by run-to-run coefficient of variation
 * (stdDev / mean) of `actualDuration`. Returns the top N, highest CV first.
 */
export function computeNoisiestTests(
  reports: (BenchmarkReport | null)[],
  topN = 10,
): NoisyTestRow[] {
  const samplesByKey = new Map<string, number[]>();

  for (const report of reports) {
    if (!report) {
      continue;
    }
    for (const [entryName, entry] of Object.entries(report)) {
      for (const render of entry.renders) {
        const key = `${entryName} / ${render.id}:${render.phase}`;
        let samples = samplesByKey.get(key);
        if (!samples) {
          samples = [];
          samplesByKey.set(key, samples);
        }
        samples.push(render.actualDuration);
      }
    }
  }

  const rows: NoisyTestRow[] = [];
  for (const [name, samples] of samplesByKey) {
    if (samples.length < MIN_SAMPLES) {
      continue;
    }
    const count = samples.length;
    let sum = 0;
    for (const sample of samples) {
      sum += sample;
    }
    const mean = sum / count;
    if (mean === 0) {
      continue;
    }
    let squaredDiffSum = 0;
    for (const sample of samples) {
      const diff = sample - mean;
      squaredDiffSum += diff * diff;
    }
    const stdDev = Math.sqrt(squaredDiffSum / (count - 1));
    rows.push({ name, runs: count, mean, stdDev, cv: stdDev / mean });
  }

  rows.sort((rowA, rowB) => {
    if (rowB.cv !== rowA.cv) {
      return rowB.cv - rowA.cv;
    }
    if (rowB.stdDev !== rowA.stdDev) {
      return rowB.stdDev - rowA.stdDev;
    }
    return rowA.name.localeCompare(rowB.name);
  });

  return rows.slice(0, topN);
}
