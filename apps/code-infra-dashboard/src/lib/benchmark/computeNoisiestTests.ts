import type { BenchmarkReport } from './types';

export type NoisinessMode = 'totalDuration' | 'perRender';

export interface NoisyTestRow {
  name: string;
  runs: number;
  mean: number;
  stdDev: number;
  cv: number;
}

const MIN_SAMPLES = 2;

function collectSamples(
  reports: (BenchmarkReport | null)[],
  mode: NoisinessMode,
): Map<string, number[]> {
  const samplesByKey = new Map<string, number[]>();
  for (const report of reports) {
    if (!report) {
      continue;
    }
    for (const [entryName, entry] of Object.entries(report)) {
      if (mode === 'totalDuration') {
        let samples = samplesByKey.get(entryName);
        if (!samples) {
          samples = [];
          samplesByKey.set(entryName, samples);
        }
        samples.push(entry.totalDuration);
      } else {
        // The same (id, phase) pair can appear multiple times within a test
        // run (e.g. an update phase fires twice). Track per-entry occurrence
        // so run N's k-th update is compared against other runs' k-th update,
        // not pooled together.
        const occurrences = new Map<string, number>();
        for (const render of entry.renders) {
          const baseKey = `${entryName} / ${render.id}:${render.phase}`;
          const occurrence = occurrences.get(baseKey) ?? 0;
          occurrences.set(baseKey, occurrence + 1);
          const key = occurrence === 0 ? baseKey : `${baseKey}#${occurrence + 1}`;
          let samples = samplesByKey.get(key);
          if (!samples) {
            samples = [];
            samplesByKey.set(key, samples);
          }
          samples.push(render.actualDuration);
        }
      }
    }
  }
  return samplesByKey;
}

/**
 * Rank tests across the provided reports by run-to-run coefficient of variation
 * (stdDev / mean). In `totalDuration` mode, samples are per-test `totalDuration`.
 * In `perRender` mode, samples are per-render `actualDuration`, keyed by
 * `{testName} / {renderId}:{phase}`. Returns all ranked rows by default,
 * highest CV first; pass `topN` to cap the result.
 */
export function computeNoisiestTests(
  reports: (BenchmarkReport | null)[],
  mode: NoisinessMode = 'totalDuration',
  topN = Infinity,
): NoisyTestRow[] {
  const samplesByKey = collectSamples(reports, mode);

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
