import { formatDiffMs, formatMetricDiff, percentFormatter } from '@/utils/formatters';
import type {
  BenchmarkBaseUpload,
  BenchmarkReportEntry,
  MetricDefinition,
  MetricStats,
  RenderStats,
} from './types';
import { welchTTest } from './welchTTest';

/** A report paired with its own metric definitions — the unit the comparison operates on. */
export type BenchmarkComparisonInput = Pick<BenchmarkBaseUpload, 'report' | 'metricDefinitions'>;

/** Significance level: a difference must be less likely than this under the null to count as real. */
const SIGNIFICANCE_ALPHA = 0.05;
/**
 * Minimum relative change worth flagging once a difference is significant. The p-value now rejects
 * noise, so this is a pure "is it big enough to act on" floor rather than a noise band, and can be
 * tighter than the legacy ±20%.
 */
const MIN_EFFECT_SIZE = 0.05;
/**
 * Legacy relative noise band. Kept only as the fallback for series that can't be tested — a
 * baseline uploaded before per-series sample counts existed, or a series with zero variance — so
 * those still produce a sensible diff.
 */
const NOISE_THRESHOLD = 0.2;

/** Default paint series key (the unnamed sentinel). Named markers are `bench:paint#<id>` sub-series. */
const PAINT_DEFAULT_KEY = 'bench:paint';

export type BenchmarkDiffSeverity = 'error' | 'warning' | 'success' | 'neutral';

export interface DiffValue {
  current: number | null;
  base: number | null;
  absoluteDiff: number;
  relativeDiff: number;
  severity: BenchmarkDiffSeverity;
  hint: string;
  /** Two-sided Welch p-value when a significance test ran; `null` when it couldn't (see fallback). */
  pValue: number | null;
  /** Whether the difference cleared the significance threshold. `false` when no test ran. */
  significant: boolean;
}

export interface ComparisonEntry {
  name: string;
  value: number;
  stdDev: number;
  outliers: number;
  diff: DiffValue;
  removed: boolean;
  /** Display formatting for custom metrics; absent for renders and built-in (paint) metrics. */
  format?: Intl.NumberFormatOptions;
}

export interface ComparisonItem {
  name: string;
  duration: DiffValue;
  renderCount?: DiffValue;
  renders: ComparisonEntry[];
  metrics: ComparisonEntry[];
  iterations: number;
}

const SEVERITY_RANK: Record<BenchmarkDiffSeverity, number> = {
  error: 0,
  warning: 1,
  success: 2,
  neutral: 3,
};

export interface BenchmarkComparisonReport {
  hasBase: boolean;
  entries: ComparisonItem[];
  totals: {
    duration: DiffValue;
    renderCount: DiffValue;
    /** Aggregate `bench:paint` (default series) summed across all tests; null when no test reports paint. */
    paintDefault: DiffValue | null;
  };
}

/** Summary of one measured series, as fed to Welch's t-test. `n` is absent on legacy uploads. */
interface SeriesStats {
  mean: number;
  stdDev: number;
  n: number | undefined;
}

function computeRelative(
  current: number,
  base: number,
): { absoluteDiff: number; relativeDiff: number } {
  const absoluteDiff = current - base;
  const relativeDiff = base !== 0 ? absoluteDiff / base : 0;
  return { absoluteDiff, relativeDiff };
}

function formatPValue(pValue: number): string {
  return pValue < 0.001 ? 'p<0.001' : `p=${pValue.toFixed(3)}`;
}

function computeSeverity(absoluteDiff: number, flagged: boolean): BenchmarkDiffSeverity {
  if (!flagged || absoluteDiff === 0) {
    return 'neutral';
  }
  return absoluteDiff > 0 ? 'error' : 'success';
}

/**
 * Diff for a series that can't be tested statistically (no sample count, or zero variance). Falls
 * back to the legacy fixed relative noise band so older baselines still render sensibly.
 */
function legacyDiff(current: number | null, base: number): DiffValue {
  const currentVal = current ?? 0;
  const { absoluteDiff, relativeDiff } = computeRelative(currentVal, base);
  const withinNoise = Math.abs(relativeDiff) <= NOISE_THRESHOLD;

  let hint: string;
  if (absoluteDiff === 0) {
    hint = 'No change';
  } else {
    const diffStr = `${formatDiffMs(absoluteDiff)} (${percentFormatter.format(relativeDiff)})`;
    if (withinNoise) {
      hint = `Within noise (±${percentFormatter.format(NOISE_THRESHOLD)}): ${diffStr}`;
    } else if (absoluteDiff > 0) {
      hint = `Regression: ${diffStr}`;
    } else {
      hint = `Improvement: ${diffStr}`;
    }
  }

  return {
    current,
    base,
    absoluteDiff,
    relativeDiff,
    severity: computeSeverity(absoluteDiff, !withinNoise),
    pValue: null,
    significant: false,
    hint,
  };
}

/**
 * Diff for a millisecond-valued series (renders, totals, paint without a definition), gated on
 * Welch's t-test: a change is flagged only when it is statistically significant *and* clears the
 * minimum effect size. Falls back to {@link legacyDiff} when the test can't run.
 */
function statisticalDiff(current: SeriesStats | null, base: SeriesStats | null): DiffValue {
  // New series (absent in base): neutral, like a brand-new entry.
  if (base === null) {
    return {
      current: current?.mean ?? null,
      base: null,
      absoluteDiff: 0,
      relativeDiff: 0,
      severity: 'neutral',
      pValue: null,
      significant: false,
      hint: 'New',
    };
  }
  // Removed series (absent in current): fall back so it renders as a drop to zero.
  if (current === null) {
    return legacyDiff(null, base.mean);
  }

  const welch =
    current.n !== undefined && base.n !== undefined
      ? welchTTest(
          { mean: current.mean, stdDev: current.stdDev, n: current.n },
          { mean: base.mean, stdDev: base.stdDev, n: base.n },
        )
      : null;

  if (!welch) {
    return legacyDiff(current.mean, base.mean);
  }

  const { absoluteDiff, relativeDiff } = computeRelative(current.mean, base.mean);
  const significant = welch.pValue < SIGNIFICANCE_ALPHA;
  const meetsEffect = Math.abs(relativeDiff) >= MIN_EFFECT_SIZE;
  const flagged = absoluteDiff !== 0 && significant && meetsEffect;

  let hint: string;
  if (absoluteDiff === 0) {
    hint = 'No change';
  } else {
    const diffStr = `${formatDiffMs(absoluteDiff)} (${percentFormatter.format(relativeDiff)})`;
    if (!significant) {
      hint = `Not significant (${formatPValue(welch.pValue)}): ${diffStr}`;
    } else if (!meetsEffect) {
      hint = `Below threshold (±${percentFormatter.format(MIN_EFFECT_SIZE)}): ${diffStr}`;
    } else {
      const verb = absoluteDiff > 0 ? 'Regression' : 'Improvement';
      hint = `${verb} (${formatPValue(welch.pValue)}): ${diffStr}`;
    }
  }

  return {
    current: current.mean,
    base: base.mean,
    absoluteDiff,
    relativeDiff,
    severity: computeSeverity(absoluteDiff, flagged),
    pValue: welch.pValue,
    significant,
    hint,
  };
}

function makeCountDiffValue(current: number, base: number): DiffValue {
  const { absoluteDiff, relativeDiff } = computeRelative(current, base);
  return {
    current,
    base,
    absoluteDiff,
    relativeDiff,
    severity: computeSeverity(absoluteDiff, absoluteDiff !== 0),
    pValue: null,
    significant: false,
    hint:
      absoluteDiff === 0
        ? 'No change'
        : `${absoluteDiff > 0 ? '+' : ''}${absoluteDiff} render${Math.abs(absoluteDiff) !== 1 ? 's' : ''}`,
  };
}

function renderStats(
  render: Pick<RenderStats, 'actualDuration' | 'stdDev' | 'count'>,
): SeriesStats {
  return { mean: render.actualDuration, stdDev: render.stdDev, n: render.count };
}

function metricSeriesStats(stats: Pick<MetricStats, 'mean' | 'stdDev' | 'count'>): SeriesStats {
  return { mean: stats.mean, stdDev: stats.stdDev, n: stats.count };
}

function compareRenders(
  currentRenders: RenderStats[],
  baseEntry: BenchmarkReportEntry | undefined,
): ComparisonEntry[] {
  const entries: ComparisonEntry[] = [];

  for (const render of currentRenders) {
    const baseRender = baseEntry?.renders.find(
      (candidate) => candidate.id === render.id && candidate.phase === render.phase,
    );
    entries.push({
      name: `${render.id}:${render.phase}`,
      value: render.actualDuration,
      stdDev: render.stdDev,
      outliers: render.outliers,
      diff: statisticalDiff(renderStats(render), baseRender ? renderStats(baseRender) : null),
      removed: false,
    });
  }

  // Removed renders (in base but not in current)
  if (baseEntry) {
    for (const baseRender of baseEntry.renders) {
      const exists = currentRenders.some(
        (candidate) => candidate.id === baseRender.id && candidate.phase === baseRender.phase,
      );
      if (!exists) {
        entries.push({
          name: `${baseRender.id}:${baseRender.phase}`,
          value: 0,
          stdDev: 0,
          outliers: 0,
          diff: statisticalDiff(null, renderStats(baseRender)),
          removed: true,
        });
      }
    }
  }

  return entries;
}

/** Strips a `#sub-series` suffix to recover the metric name used to look up its definition. */
function baseMetricName(key: string): string {
  const hashIndex = key.indexOf('#');
  return hashIndex === -1 ? key : key.slice(0, hashIndex);
}

/**
 * Diff for a custom metric, honoring its definition. A metric without an `alarm` is informational
 * (always neutral). A discrete alarm is compared as an exact integer. A scalar alarm is compared
 * against its `warn`/`error` bands (effect size) *and*, when sample counts are available, gated on
 * Welch's t-test — a scalar regression is only flagged when it is both past its band and
 * statistically significant. Scalar metrics without explicit bands use the {@link MIN_EFFECT_SIZE}
 * floor. Without sample counts the metric falls back to the legacy fixed noise band.
 */
function makeMetricDiff(
  current: SeriesStats,
  base: SeriesStats | null,
  definition: MetricDefinition,
): DiffValue {
  if (base === null) {
    return {
      current: current.mean,
      base: null,
      absoluteDiff: 0,
      relativeDiff: 0,
      severity: 'neutral',
      pValue: null,
      significant: false,
      hint: 'New',
    };
  }

  const { absoluteDiff, relativeDiff } = computeRelative(current.mean, base.mean);

  const { alarm, kind } = definition;
  const isDiscrete = kind === 'discrete';
  const diffStr = isDiscrete
    ? `${absoluteDiff > 0 ? '+' : ''}${absoluteDiff}`
    : `${formatMetricDiff(absoluteDiff, definition.format)} (${percentFormatter.format(relativeDiff)})`;

  // Informational metric: show the change, never flag it.
  if (!alarm) {
    return {
      current: current.mean,
      base: base.mean,
      absoluteDiff,
      relativeDiff,
      severity: 'neutral',
      pValue: null,
      significant: false,
      hint: absoluteDiff === 0 ? 'No change' : diffStr,
    };
  }

  // Scalar metrics can be tested for significance; discrete counts are exact and never are.
  const welch =
    !isDiscrete && current.n !== undefined && base.n !== undefined
      ? welchTTest(
          { mean: current.mean, stdDev: current.stdDev, n: current.n },
          { mean: base.mean, stdDev: base.stdDev, n: base.n },
        )
      : null;
  const significant = welch !== null && welch.pValue < SIGNIFICANCE_ALPHA;

  // Scalar bands are relative fractions; discrete bands are absolute count deltas, and meet their
  // threshold inclusively (an `error: 2` discrete alarm fires on a delta of exactly 2).
  const magnitude = isDiscrete ? Math.abs(absoluteDiff) : Math.abs(relativeDiff);
  const meets = (band: number) => (isDiscrete ? magnitude >= band : magnitude > band);

  // When no bands are given, `error` falls back to the effect-size floor once we can test (scalar),
  // the legacy noise band otherwise (scalar), or any change (discrete). With only `warn`, no error.
  let defaultError: number;
  if (isDiscrete) {
    defaultError = 0;
  } else {
    defaultError = welch ? MIN_EFFECT_SIZE : NOISE_THRESHOLD;
  }
  const errorBand = alarm.error ?? (alarm.warn === undefined ? defaultError : undefined);
  const warnBand = alarm.warn;

  let level: 'none' | 'warn' | 'error' = 'none';
  if (absoluteDiff !== 0) {
    if (errorBand !== undefined && meets(errorBand)) {
      level = 'error';
    } else if (warnBand !== undefined && meets(warnBand)) {
      level = 'warn';
    }
  }

  // A scalar band tells us the change is large; the t-test tells us it is real. Require both: a
  // non-significant scalar change is demoted to neutral even when it clears its band.
  if (welch && !significant) {
    level = 'none';
  }

  const direction = alarm.direction ?? 'lowerIsBetter';
  const isRegression = direction === 'lowerIsBetter' ? absoluteDiff > 0 : absoluteDiff < 0;

  let severity: BenchmarkDiffSeverity = 'neutral';
  if (level !== 'none') {
    if (!isRegression) {
      severity = 'success';
    } else {
      severity = level === 'error' ? 'error' : 'warning';
    }
  }

  const pSuffix = welch ? ` (${formatPValue(welch.pValue)})` : '';
  let hint: string;
  if (absoluteDiff === 0) {
    hint = 'No change';
  } else if (level === 'none') {
    hint =
      welch && !significant
        ? `Not significant (${formatPValue(welch.pValue)}): ${diffStr}`
        : `Within noise: ${diffStr}`;
  } else if (!isRegression) {
    hint = `Improvement: ${diffStr}${pSuffix}`;
  } else {
    hint = `${level === 'error' ? 'Regression' : 'Warning'}: ${diffStr}${pSuffix}`;
  }

  return {
    current: current.mean,
    base: base.mean,
    absoluteDiff,
    relativeDiff,
    severity,
    pValue: welch?.pValue ?? null,
    significant,
    hint,
  };
}

function compareMetrics(
  currentMetrics: Record<string, MetricStats>,
  baseEntry: BenchmarkReportEntry | undefined,
  currentDefinitions: Record<string, MetricDefinition> | undefined,
  baseDefinitions: Record<string, MetricDefinition> | undefined,
): ComparisonEntry[] {
  const entries: ComparisonEntry[] = [];

  for (const [name, stats] of Object.entries(currentMetrics)) {
    const definition = currentDefinitions?.[baseMetricName(name)];
    const baseStats = baseEntry?.metrics[name];
    const baseSeries = baseStats ? metricSeriesStats(baseStats) : null;
    entries.push({
      name,
      value: stats.mean,
      stdDev: stats.stdDev,
      outliers: stats.outliers,
      diff: definition
        ? makeMetricDiff(metricSeriesStats(stats), baseSeries, definition)
        : statisticalDiff(metricSeriesStats(stats), baseSeries),
      removed: false,
      format: definition?.format,
    });
  }

  // Removed metrics
  if (baseEntry) {
    for (const [name, baseStats] of Object.entries(baseEntry.metrics)) {
      if (!(name in currentMetrics)) {
        const definition = baseDefinitions?.[baseMetricName(name)];
        entries.push({
          name,
          value: 0,
          stdDev: 0,
          outliers: 0,
          diff: statisticalDiff(null, metricSeriesStats(baseStats)),
          removed: true,
          format: definition?.format,
        });
      }
    }
  }

  return entries;
}

/**
 * Folds a benchmark's renders into a combined-duration variance and a sample count. The total's
 * variance is approximated as the sum of per-render variances (treating renders as independent),
 * and its `n` as the smallest render sample count. `missing` marks that a render lacked a count,
 * which forces the total onto the legacy comparison path.
 */
function foldRenderStats(renders: RenderStats[]): {
  variance: number;
  minCount: number | undefined;
  missing: boolean;
} {
  let variance = 0;
  let minCount: number | undefined;
  let missing = false;
  for (const render of renders) {
    variance += render.stdDev * render.stdDev;
    if (render.count === undefined) {
      missing = true;
    } else {
      minCount = minCount === undefined ? render.count : Math.min(minCount, render.count);
    }
  }
  return { variance, minCount, missing };
}

type RenderFold = { variance: number; minCount: number | undefined; missing: boolean };

/** Turns a mean plus a render fold into the series stats Welch's t-test consumes. */
function foldToStats(mean: number, fold: RenderFold): SeriesStats {
  return { mean, stdDev: Math.sqrt(fold.variance), n: fold.missing ? undefined : fold.minCount };
}

function worstSeverityRank(item: ComparisonItem): number {
  const renderRank = SEVERITY_RANK[item.renderCount?.severity ?? 'neutral'];
  const durationRank = SEVERITY_RANK[item.duration.severity];
  return Math.min(renderRank, durationRank);
}

function compareItems(a: ComparisonItem, b: ComparisonItem): number {
  const worstDelta = worstSeverityRank(a) - worstSeverityRank(b);
  if (worstDelta !== 0) {
    return worstDelta;
  }

  const aRenderSeverity = a.renderCount?.severity ?? 'neutral';
  const bRenderSeverity = b.renderCount?.severity ?? 'neutral';
  const renderSeverityDelta = SEVERITY_RANK[aRenderSeverity] - SEVERITY_RANK[bRenderSeverity];
  if (renderSeverityDelta !== 0) {
    return renderSeverityDelta;
  }

  const renderDiffDelta =
    Math.abs(b.renderCount?.absoluteDiff ?? 0) - Math.abs(a.renderCount?.absoluteDiff ?? 0);
  if (renderDiffDelta !== 0) {
    return renderDiffDelta;
  }

  const durationSeverityDelta =
    SEVERITY_RANK[a.duration.severity] - SEVERITY_RANK[b.duration.severity];
  if (durationSeverityDelta !== 0) {
    return durationSeverityDelta;
  }

  return Math.abs(b.duration.absoluteDiff) - Math.abs(a.duration.absoluteDiff);
}

/**
 * Builds the total-duration diff across all benchmarks. Combined variance is the sum of every
 * render's variance; combined `n` is the smallest render count seen. If any render lacked a count,
 * the total falls back to the legacy comparison.
 */
function makeTotalsDurationDiff(
  currentDuration: number,
  baseDuration: number,
  hasBase: boolean,
  current: RenderFold,
  base: RenderFold,
): DiffValue {
  if (!hasBase) {
    return statisticalDiff({ mean: currentDuration, stdDev: 0, n: undefined }, null);
  }
  return statisticalDiff(foldToStats(currentDuration, current), foldToStats(baseDuration, base));
}

export function compareBenchmarkReports(
  current: BenchmarkComparisonInput,
  base: BenchmarkComparisonInput | null,
): BenchmarkComparisonReport {
  // Definitions travel with their report: a current metric uses the current definitions, a
  // base-only/removed metric uses the base definitions. No merge step — the side a metric appears
  // on decides how it's formatted.
  const currentDefinitions = current.metricDefinitions;
  const baseDefinitions = base?.metricDefinitions;
  const currentReport = current.report;
  const effectiveBase = base?.report ?? {};
  const entries: ComparisonItem[] = [];

  let totalCurrentDuration = 0;
  let totalBaseDuration = 0;
  let totalCurrentRenders = 0;
  let totalBaseRenders = 0;
  let totalCurrentPaint = 0;
  let totalBasePaint = 0;
  let hasPaint = false;

  // Accumulated variance / min sample count across all renders, for the grand-total significance.
  let totalCurrentVariance = 0;
  let totalBaseVariance = 0;
  let totalCurrentMinCount: number | undefined;
  let totalBaseMinCount: number | undefined;
  let totalCurrentMissing = false;
  let totalBaseMissing = false;

  const foldInto = (
    fold: { variance: number; minCount: number | undefined; missing: boolean },
    side: 'current' | 'base',
  ) => {
    if (side === 'current') {
      totalCurrentVariance += fold.variance;
      totalCurrentMissing = totalCurrentMissing || fold.missing;
      if (fold.minCount !== undefined) {
        totalCurrentMinCount =
          totalCurrentMinCount === undefined
            ? fold.minCount
            : Math.min(totalCurrentMinCount, fold.minCount);
      }
    } else {
      totalBaseVariance += fold.variance;
      totalBaseMissing = totalBaseMissing || fold.missing;
      if (fold.minCount !== undefined) {
        totalBaseMinCount =
          totalBaseMinCount === undefined
            ? fold.minCount
            : Math.min(totalBaseMinCount, fold.minCount);
      }
    }
  };

  // Process current entries
  for (const [name, entry] of Object.entries(currentReport)) {
    const baseEntry = effectiveBase[name];

    const currentFold = foldRenderStats(entry.renders);
    const baseFold = baseEntry ? foldRenderStats(baseEntry.renders) : undefined;
    const duration = statisticalDiff(
      foldToStats(entry.totalDuration, currentFold),
      baseEntry && baseFold ? foldToStats(baseEntry.totalDuration, baseFold) : null,
    );

    entries.push({
      name,
      duration,
      renderCount: baseEntry
        ? makeCountDiffValue(entry.renders.length, baseEntry.renders.length)
        : undefined,
      renders: compareRenders(entry.renders, baseEntry),
      metrics: compareMetrics(entry.metrics, baseEntry, currentDefinitions, baseDefinitions),
      iterations: entry.iterations,
    });

    totalCurrentDuration += entry.totalDuration;
    totalBaseDuration += baseEntry?.totalDuration ?? 0;
    totalCurrentRenders += entry.renders.length;
    totalBaseRenders += baseEntry?.renders.length ?? 0;
    foldInto(currentFold, 'current');
    if (baseFold) {
      foldInto(baseFold, 'base');
    }

    const paintMetric = entry.metrics[PAINT_DEFAULT_KEY];
    const basePaintMetric = baseEntry?.metrics[PAINT_DEFAULT_KEY];
    if (paintMetric || basePaintMetric) {
      hasPaint = true;
      totalCurrentPaint += paintMetric?.mean ?? 0;
      totalBasePaint += basePaintMetric?.mean ?? 0;
    }
  }

  // Process removed entries (in base but not in current)
  for (const [name, baseEntry] of Object.entries(effectiveBase)) {
    if (name in currentReport) {
      continue;
    }

    const baseFold = foldRenderStats(baseEntry.renders);
    const duration = statisticalDiff(null, foldToStats(baseEntry.totalDuration, baseFold));
    entries.push({
      name,
      duration,
      renders: compareRenders([], baseEntry),
      metrics: compareMetrics({}, baseEntry, currentDefinitions, baseDefinitions),
      iterations: 0,
    });

    totalBaseDuration += baseEntry.totalDuration;
    totalBaseRenders += baseEntry.renders.length;
    foldInto(baseFold, 'base');

    const basePaintMetric = baseEntry.metrics[PAINT_DEFAULT_KEY];
    if (basePaintMetric) {
      hasPaint = true;
      totalBasePaint += basePaintMetric.mean;
    }
  }

  entries.sort(compareItems);

  return {
    hasBase: base !== null,
    entries,
    totals: {
      duration: makeTotalsDurationDiff(
        totalCurrentDuration,
        totalBaseDuration,
        base !== null,
        {
          variance: totalCurrentVariance,
          minCount: totalCurrentMinCount,
          missing: totalCurrentMissing,
        },
        { variance: totalBaseVariance, minCount: totalBaseMinCount, missing: totalBaseMissing },
      ),
      renderCount: makeCountDiffValue(totalCurrentRenders, totalBaseRenders),
      // Paint totals are summed means with no per-series variance/count, so they use the legacy
      // relative comparison rather than a Welch test.
      paintDefault: hasPaint ? legacyDiff(totalCurrentPaint, totalBasePaint) : null,
    },
  };
}
