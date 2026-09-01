/**
 * Reduces tachometer's raw JSON output to a flat, interpretable summary.
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
 * @property {string} name - Variant name
 * @property {number} bytesSent - Bytes transferred
 * @property {ConfidenceInterval} mean - Mean duration, as a 95% confidence interval
 * @property {number[]} samples - Individual sample durations
 * @property {Array<TachometerDifference | null>} differences - This variant against each other, by index
 */

/**
 * @typedef {Object} TachometerJson
 * @property {TachometerBenchmark[]} benchmarks - One entry per variant
 */

/**
 * @typedef {'faster'|'slower'|'unsure'} Verdict
 */

/**
 * Reduces one case's tachometer output to a flat summary: every variant's mean 95% CI (ms) and
 * sample count, plus the first variant's difference against each of the others and a verdict per
 * comparison.
 *
 * The first variant is the reference because that is the one under test — for the auto-expanded
 * regression case it is `[current]`. A verdict reads the sign of the difference's confidence
 * interval: entirely below 0 is `faster`, entirely above is `slower`, and a CI that still straddles
 * 0 is `unsure` (the result did not resolve within the sampling budget).
 *
 * @param {string} name - The case name, used in error messages
 * @param {TachometerJson} json - Raw tachometer output for that case
 * @returns {{ name: string, reference: string, variants: Array<{ name: string, meanMs: ConfidenceInterval, samples: number }>, comparisons: Array<{ variant: string, verdict: Verdict, difference: { absoluteMs: ConfidenceInterval, percentChange: ConfidenceInterval } | null | undefined }> }}
 */
export function summarizeCase(name, json) {
  const [reference, ...others] = json.benchmarks;
  if (!reference) {
    throw new Error(`Case "${name}" produced no benchmarks.`);
  }

  const comparisons = others.map((other, index) => {
    // `others` is `benchmarks` without the reference at index 0, so `other` is `benchmarks[index + 1]`.
    const diff = reference.differences[index + 1];
    /** @type {Verdict} */
    let verdict = 'unsure';
    if (diff) {
      if (diff.percentChange.low > 0 && diff.percentChange.high > 0) {
        verdict = 'slower';
      } else if (diff.percentChange.low < 0 && diff.percentChange.high < 0) {
        verdict = 'faster';
      }
    }
    return {
      variant: other.name,
      verdict,
      // `reference` relative to `variant`: positive means the reference is slower.
      difference: diff && { absoluteMs: diff.absolute, percentChange: diff.percentChange },
    };
  });

  return {
    name,
    reference: reference.name,
    variants: json.benchmarks.map((benchmark) => ({
      name: benchmark.name,
      meanMs: benchmark.mean,
      samples: benchmark.samples.length,
    })),
    comparisons,
  };
}
