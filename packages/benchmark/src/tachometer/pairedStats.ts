import type {
  ConfidenceInterval,
  TachometerBenchmark,
  TachometerDifference,
  TachometerJson,
} from './summarizeCase';

/**
 * Statistics for interleaved runs, in the shape tachometer reports so the rest of the pipeline
 * (summaries, the report, the upload) reads them unchanged.
 *
 * The difference is in how differences are computed. Every variant is sampled once per round, in
 * a shuffled order, so each round is a matched set: whatever the machine was doing during that
 * round affected every variant in it. Intervals on a difference are therefore taken over the
 * per-round differences rather than over two independent sample sets, which cancels that shared
 * drift instead of counting it as noise.
 */

/** One round: a variant's measured values by measurement name, indexed like the variants. */
export type Round = Array<Record<string, number> | undefined>;

// Two-sided 95% critical values of Student's t for 1–30 degrees of freedom.
const T_95 = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145,
  2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048,
  2.045, 2.042,
];

/** The two-sided 95% critical value of Student's t, approximated past the table. */
export function tCritical95(degreesOfFreedom: number): number {
  if (degreesOfFreedom <= T_95.length) {
    return T_95[Math.max(degreesOfFreedom, 1) - 1];
  }
  // Cornish–Fisher expansion around the normal quantile; well within 0.1% past 30 degrees.
  const z = 1.959964;
  return z + (z ** 3 + z) / (4 * degreesOfFreedom);
}

function meanOf(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** The 95% confidence interval of the mean. A single value is its own degenerate interval. */
export function meanInterval(values: number[]): ConfidenceInterval {
  const mean = meanOf(values);
  if (values.length < 2) {
    return { low: mean, high: mean };
  }
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  const halfWidth = tCritical95(values.length - 1) * Math.sqrt(variance / values.length);
  return { low: mean - halfWidth, high: mean + halfWidth };
}

/** `a` against `b`, over the rounds where both were measured. */
function pairedDifference(
  rounds: Round[],
  a: number,
  b: number,
  measurement: string,
): TachometerDifference | null {
  const differences: number[] = [];
  const baseline: number[] = [];
  for (const round of rounds) {
    const valueA = round[a]?.[measurement];
    const valueB = round[b]?.[measurement];
    if (valueA !== undefined && valueB !== undefined) {
      differences.push(valueA - valueB);
      baseline.push(valueB);
    }
  }
  if (differences.length === 0) {
    return null;
  }
  const absolute = meanInterval(differences);
  const reference = meanOf(baseline);
  return {
    absolute,
    percentChange: {
      low: (absolute.low / reference) * 100,
      high: (absolute.high / reference) * 100,
    },
  };
}

/**
 * Tachometer-shaped results for interleaved rounds: one entry per measurement × variant, named
 * `<variant> [<measurement>]`, with a difference matrix over the flat list (`null` across
 * measurements, which are never compared with each other).
 */
export function toTachometerJson(
  variants: string[],
  measurements: string[],
  rounds: Round[],
): TachometerJson {
  const flat = measurements.flatMap((measurement) =>
    variants.map((variant, index) => ({ variant, index, measurement })),
  );
  const benchmarks = flat.map(({ variant, index, measurement }): TachometerBenchmark => {
    const samples = rounds.flatMap((round) => {
      const value = round[index]?.[measurement];
      return value === undefined ? [] : [value];
    });
    return {
      name: `${variant} [${measurement}]`,
      measurement: { name: measurement },
      mean: meanInterval(samples),
      samples,
      differences: flat.map((other) =>
        other.measurement === measurement && other.index !== index
          ? pairedDifference(rounds, index, other.index, measurement)
          : null,
      ),
    };
  });
  return { benchmarks };
}

/** Measurement names every sample of every variant reported, in first-seen order. */
export function stableMeasurements(rounds: Round[]): string[] {
  const seen = new Set<string>();
  for (const round of rounds) {
    for (const values of round) {
      for (const name of Object.keys(values ?? {})) {
        seen.add(name);
      }
    }
  }
  return [...seen].filter((name) =>
    rounds.every((round) => round.every((values) => values?.[name] !== undefined)),
  );
}

/** A random permutation of `0..length-1`, so no variant always runs first in its round. */
export function shuffledIndices(length: number): number[] {
  const indices = Array.from({ length }, (_, index) => index);
  for (let index = indices.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [indices[index], indices[swap]] = [indices[swap], indices[index]];
  }
  return indices;
}
