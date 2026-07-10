/**
 * Welch's two-sample t-test and the supporting Student-t distribution, implemented from summary
 * statistics only (no raw samples). This is the significance gate the benchmark comparison uses to
 * decide whether a mean difference is real before flagging it.
 *
 * Custom (no dependency) per the repo's "avoid dependencies" guidance: the only non-trivial piece
 * is the regularized incomplete beta function, a standard numerical routine.
 */

/** Summary of one measured series. `stdDev` is the population standard deviation (÷n). */
export interface SampleSummary {
  mean: number;
  /** Population standard deviation as produced by the harness (`calculateStdDev`, divides by n). */
  stdDev: number;
  /** Effective sample count behind `mean`/`stdDev`. */
  n: number;
}

export interface WelchResult {
  /** The t statistic. Positive when `a.mean > b.mean`. */
  t: number;
  /** Welch–Satterthwaite degrees of freedom. */
  df: number;
  /** Two-sided p-value: the probability of a |t| at least this large under the null hypothesis. */
  pValue: number;
}

// Lanczos approximation coefficients (g = 7), accurate to ~15 significant digits.
const LANCZOS_G = 7;
const LANCZOS_COEFFICIENTS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

/** Natural log of the gamma function via the Lanczos approximation. */
function logGamma(value: number): number {
  if (value < 0.5) {
    // Reflection formula for the left half-plane.
    return Math.log(Math.PI / Math.sin(Math.PI * value)) - logGamma(1 - value);
  }
  const shifted = value - 1;
  let series = LANCZOS_COEFFICIENTS[0];
  for (let index = 1; index < LANCZOS_G + 2; index += 1) {
    series += LANCZOS_COEFFICIENTS[index] / (shifted + index);
  }
  const tValue = shifted + LANCZOS_G + 0.5;
  return (
    0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(tValue) - tValue + Math.log(series)
  );
}

/**
 * Continued-fraction expansion for the incomplete beta function, evaluated with the modified Lentz
 * algorithm (Numerical Recipes, §6.4). Converges rapidly for `x < (a+1)/(a+b+2)`.
 */
function betaContinuedFraction(x: number, a: number, b: number): number {
  const MAX_ITERATIONS = 200;
  const EPSILON = 3e-12;
  const TINY = 1e-300;

  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;

  let cTerm = 1;
  let dTerm = 1 - (qab * x) / qap;
  if (Math.abs(dTerm) < TINY) {
    dTerm = TINY;
  }
  dTerm = 1 / dTerm;
  let result = dTerm;

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
    const even = 2 * iteration;

    // Even step of the recurrence.
    let numerator = (iteration * (b - iteration) * x) / ((qam + even) * (a + even));
    dTerm = 1 + numerator * dTerm;
    if (Math.abs(dTerm) < TINY) {
      dTerm = TINY;
    }
    cTerm = 1 + numerator / cTerm;
    if (Math.abs(cTerm) < TINY) {
      cTerm = TINY;
    }
    dTerm = 1 / dTerm;
    result *= dTerm * cTerm;

    // Odd step of the recurrence.
    numerator = (-(a + iteration) * (qab + iteration) * x) / ((a + even) * (qap + even));
    dTerm = 1 + numerator * dTerm;
    if (Math.abs(dTerm) < TINY) {
      dTerm = TINY;
    }
    cTerm = 1 + numerator / cTerm;
    if (Math.abs(cTerm) < TINY) {
      cTerm = TINY;
    }
    dTerm = 1 / dTerm;
    const delta = dTerm * cTerm;
    result *= delta;

    if (Math.abs(delta - 1) < EPSILON) {
      break;
    }
  }

  return result;
}

/**
 * Regularized incomplete beta function `I_x(a, b)`. Returns a value in `[0, 1]`.
 *
 * See https://en.wikipedia.org/wiki/Beta_function#Incomplete_beta_function
 */
export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) {
    return 0;
  }
  if (x >= 1) {
    return 1;
  }

  const logFront =
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  const front = Math.exp(logFront);

  // Use the expansion that converges fastest for this x, and the symmetry
  // I_x(a, b) = 1 - I_{1-x}(b, a) otherwise.
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(x, a, b)) / a;
  }
  return 1 - (front * betaContinuedFraction(1 - x, b, a)) / b;
}

/**
 * Two-sided p-value for a t statistic — `P(|T| >= |t|)`. Computed directly from the incomplete
 * beta (not `2 * (1 - cdf)`) so it stays accurate deep in the tail where the CDF rounds to 1.
 */
function studentTTwoSidedPValue(t: number, df: number): number {
  if (!Number.isFinite(t)) {
    return 0;
  }
  const x = df / (df + t * t);
  return regularizedIncompleteBeta(x, df / 2, 0.5);
}

/**
 * One side of a Welch test reduced to the quantities that actually combine: its mean, the variance
 * of that mean estimate (`standardErrorSquared`), and its Satterthwaite term. For a single sample
 * the term is `(standardErrorSquared)² / (n - 1)`; for a *sum* of independent series (e.g. a grand
 * total across benchmarks) the standard errors and the terms simply add, which is what lets the
 * totals comparison pool unequal-count benchmarks correctly.
 */
export interface WelchComponent {
  mean: number;
  /** Variance of the mean estimate — the standard error squared. */
  standardErrorSquared: number;
  /** Satterthwaite denominator contribution; combines across both sides into the degrees of freedom. */
  satterthwaiteTerm: number;
}

/** Reduces a single series summary to its Welch component. Returns `null` for `n < 2`. */
function sampleComponent(sample: SampleSummary): WelchComponent | null {
  if (sample.n < 2) {
    return null;
  }
  // Convert the stored population variance (÷n) to the variance of the mean:
  // s²/n = (stdDev² · n/(n-1)) / n = stdDev²/(n-1).
  const standardErrorSquared = (sample.stdDev * sample.stdDev) / (sample.n - 1);
  return {
    mean: sample.mean,
    standardErrorSquared,
    satterthwaiteTerm: (standardErrorSquared * standardErrorSquared) / (sample.n - 1),
  };
}

/**
 * Welch's t-test from two already-reduced {@link WelchComponent}s — the shared core. The summary-
 * stats {@link welchTTest} and the grand-total comparison (which sums components across independent
 * benchmarks) both funnel through here.
 *
 * Returns `null` when the test is undefined: the combined standard error or the Satterthwaite
 * denominator is zero (both sides effectively varianceless).
 */
export function welchTTestFromComponents(a: WelchComponent, b: WelchComponent): WelchResult | null {
  const combinedStandardError = a.standardErrorSquared + b.standardErrorSquared;
  const satterthwaiteDenominator = a.satterthwaiteTerm + b.satterthwaiteTerm;
  if (combinedStandardError <= 0 || satterthwaiteDenominator <= 0) {
    return null;
  }

  const t = (a.mean - b.mean) / Math.sqrt(combinedStandardError);
  const df = (combinedStandardError * combinedStandardError) / satterthwaiteDenominator;

  return { t, df, pValue: studentTTwoSidedPValue(t, df) };
}

/**
 * Welch's t-test for two independent series described by their summary statistics. Handles unequal
 * variances and unequal sample sizes (which adaptive sampling produces).
 *
 * Returns `null` when the test is undefined — either side has `n < 2`, or both sides have zero
 * variance — so the caller can fall back to a non-statistical comparison.
 */
export function welchTTest(a: SampleSummary, b: SampleSummary): WelchResult | null {
  const componentA = sampleComponent(a);
  const componentB = sampleComponent(b);
  if (!componentA || !componentB) {
    return null;
  }
  return welchTTestFromComponents(componentA, componentB);
}
