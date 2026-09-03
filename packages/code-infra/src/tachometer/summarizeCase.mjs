import chalk from 'chalk';

/**
 * Reduces tachometer's raw JSON output to a flat, interpretable summary.
 */

/**
 * @typedef {import('./discoverCases.mjs').BenchmarkCase} BenchmarkCase
 */

/**
 * @typedef {Object} ConfidenceInterval
 * @property {number} low - Lower bound
 * @property {number} high - Upper bound
 */

/**
 * @typedef {Object} TachometerDifference
 * @property {ConfidenceInterval} absolute - Absolute difference, in milliseconds
 * @property {ConfidenceInterval} percentChange - Relative difference, as a percentage
 */

/**
 * @typedef {Object} TachometerBenchmark
 * @property {string} name - Variant name, suffixed with ` [<measurement>]` when a page has several
 * @property {number} bytesSent - Bytes transferred
 * @property {ConfidenceInterval} mean - Mean duration, as a 95% confidence interval
 * @property {number[]} samples - Individual sample durations
 * @property {{ name?: string }} [measurement] - The measurement this entry reports
 * @property {Array<TachometerDifference | null>} differences - This entry against every other, by flat index
 */

/**
 * @typedef {Object} TachometerJson
 * @property {TachometerBenchmark[]} benchmarks - One entry per variant × measurement
 */

/**
 * @typedef {'faster'|'slower'|'unsure'} Verdict
 */

/**
 * Judges a difference.
 *
 * A difference only counts as `faster`/`slower` when the millisecond interval and the percent
 * interval both exclude zero on the same side. They come from the same samples but are computed
 * separately, so near zero one can exclude it while the other does not — and a verdict that rests
 * on only one of them flips depending on which is read.
 *
 * @param {TachometerDifference} difference - A difference from tachometer's matrix
 * @returns {Verdict}
 */
export function verdictOf(difference) {
  if (difference.absolute.low > 0 && difference.percentChange.low > 0) {
    return 'slower';
  }
  if (difference.absolute.high < 0 && difference.percentChange.high < 0) {
    return 'faster';
  }
  return 'unsure';
}

/**
 * Indexes tachometer's flat benchmark list by measurement and then by variant, keeping each entry's
 * position so the difference matrix can be read back.
 *
 * @param {TachometerJson} json - Raw tachometer output
 * @returns {Map<string, Map<string, { benchmark: TachometerBenchmark, index: number }>>}
 */
function indexByMeasurement(json) {
  /** @type {Map<string, Map<string, { benchmark: TachometerBenchmark, index: number }>>} */
  const byMeasurement = new Map();
  json.benchmarks.forEach((benchmark, index) => {
    const measurement = benchmark.measurement?.name ?? '';
    const suffix = ` [${measurement}]`;
    const variant = benchmark.name.endsWith(suffix)
      ? benchmark.name.slice(0, -suffix.length)
      : benchmark.name;
    const forMeasurement = byMeasurement.get(measurement) ?? new Map();
    forMeasurement.set(variant, { benchmark, index });
    byMeasurement.set(measurement, forMeasurement);
  });
  return byMeasurement;
}

/**
 * Reduces one case's tachometer output to a per-measurement summary.
 *
 * Tachometer flattens variants × measurements into one list, naming entries
 * `<variant> [<measurement>]` when a page declares more than one, with a difference matrix over the
 * whole flat list. Results are paired back by (variant, measurement) name — pairing by position
 * would compare unrelated measurements as soon as a case has more than one.
 *
 * The first declared variant is the reference, because that is the one under test: for the
 * auto-expanded regression case it is `[current]`.
 *
 * @param {BenchmarkCase} entry - The discovered case, which declares the variants and measurements
 * @param {TachometerJson} json - Raw tachometer output for that case
 * @returns {{ name: string, reference: string, measurements: Array<{ name: string, variants: Array<{ variant: string, refId: string | null, meanMs: ConfidenceInterval, samples: number, bytesSent: number }>, comparisons: Array<{ variant: string, verdict: Verdict, absoluteMs: ConfidenceInterval, percentChange: ConfidenceInterval, versusReference?: { verdict: Verdict, absoluteMs: ConfidenceInterval, percentChange: ConfidenceInterval } }> }> }}
 */
export function summarizeCase(entry, json) {
  const [reference] = entry.variants;
  if (!reference) {
    throw new Error(`Case "${entry.name}" declares no variants.`);
  }

  const byMeasurement = indexByMeasurement(json);

  const measurements = entry.measurements.map((measurement) => {
    const byVariant = byMeasurement.get(measurement);
    /**
     * @param {string} variant - Variant name to look up
     * @returns {{ benchmark: TachometerBenchmark, index: number } | undefined}
     */
    const lookup = (variant) => byVariant?.get(variant);

    const referenceResult = lookup(reference.name);
    if (!referenceResult) {
      throw new Error(
        `Case "${entry.name}": no "${measurement}" result for the reference "${reference.name}".`,
      );
    }

    const variants = [];
    const comparisons = [];
    for (const variant of entry.variants) {
      const found = lookup(variant.name);
      if (!found) {
        console.warn(
          chalk.yellow(
            `  ${entry.name}: no "${measurement}" result for "${variant.name}"; skipping.`,
          ),
        );
        continue;
      }
      variants.push({
        variant: variant.name,
        refId: variant.refId,
        meanMs: found.benchmark.mean,
        samples: found.benchmark.samples.length,
        bytesSent: found.benchmark.bytesSent,
      });
      if (variant.name === reference.name) {
        continue;
      }
      const difference = referenceResult.benchmark.differences[found.index];
      if (!difference) {
        continue;
      }
      // The same pair read from the variant's own matrix row. Each direction has its own
      // denominator, so it is not the negation of `difference`.
      const reverse = found.benchmark.differences[referenceResult.index];
      comparisons.push({
        variant: variant.name,
        verdict: verdictOf(difference),
        absoluteMs: difference.absolute,
        percentChange: difference.percentChange,
        versusReference: reverse
          ? {
              verdict: verdictOf(reverse),
              absoluteMs: reverse.absolute,
              percentChange: reverse.percentChange,
            }
          : undefined,
      });
    }
    return { name: measurement, variants, comparisons };
  });

  return { name: entry.name, reference: reference.name, measurements };
}
