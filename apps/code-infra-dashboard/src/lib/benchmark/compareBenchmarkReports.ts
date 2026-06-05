import { formatDiffMs, percentFormatter } from '@/utils/formatters';
import type { BenchmarkReport, BenchmarkReportEntry, MetricDefinition, RenderStats } from './types';

const NOISE_THRESHOLD = 0.2;

export type BenchmarkDiffSeverity = 'error' | 'success' | 'neutral';

export interface DiffValue {
  current: number | null;
  base: number | null;
  absoluteDiff: number;
  relativeDiff: number;
  severity: BenchmarkDiffSeverity;
  hint: string;
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
  success: 1,
  neutral: 2,
};

export interface BenchmarkComparisonReport {
  hasBase: boolean;
  entries: ComparisonItem[];
  totals: {
    duration: DiffValue;
    renderCount: DiffValue;
    paintDefault: DiffValue | null;
  };
}

function computeSeverity(absoluteDiff: number, withinNoise: boolean): BenchmarkDiffSeverity {
  if (withinNoise || absoluteDiff === 0) {
    return 'neutral';
  }
  return absoluteDiff > 0 ? 'error' : 'success';
}

function buildHint(absoluteDiff: number, relativeDiff: number, withinNoise: boolean): string {
  if (absoluteDiff === 0) {
    return 'No change';
  }
  const diffStr = `${formatDiffMs(absoluteDiff)} (${percentFormatter.format(relativeDiff)})`;
  if (withinNoise) {
    return `Within noise (±${percentFormatter.format(NOISE_THRESHOLD)}): ${diffStr}`;
  }
  if (absoluteDiff > 0) {
    return `Regression: ${diffStr}`;
  }
  return `Improvement: ${diffStr}`;
}

function makeDiffValue(current: number | null, base: number | null): DiffValue {
  if (base === null) {
    return {
      current,
      base,
      absoluteDiff: 0,
      relativeDiff: 0,
      severity: 'neutral',
      hint: 'New',
    };
  }

  const currentVal = current ?? 0;
  const absoluteDiff = currentVal - base;
  const relativeDiff = base !== 0 ? absoluteDiff / base : 0;
  const withinNoise = Math.abs(relativeDiff) <= NOISE_THRESHOLD;
  return {
    current,
    base,
    absoluteDiff,
    relativeDiff,
    severity: computeSeverity(absoluteDiff, withinNoise),
    hint: buildHint(absoluteDiff, relativeDiff, withinNoise),
  };
}

function makeCountDiffValue(current: number, base: number): DiffValue {
  const absoluteDiff = current - base;
  const relativeDiff = base !== 0 ? absoluteDiff / base : 0;
  return {
    current,
    base,
    absoluteDiff,
    relativeDiff,
    severity: computeSeverity(absoluteDiff, false),
    hint:
      absoluteDiff === 0
        ? 'No change'
        : `${absoluteDiff > 0 ? '+' : ''}${absoluteDiff} render${Math.abs(absoluteDiff) !== 1 ? 's' : ''}`,
  };
}

function compareRenders(
  currentRenders: RenderStats[],
  baseEntry: BenchmarkReportEntry | undefined,
): ComparisonEntry[] {
  const entries: ComparisonEntry[] = [];

  for (const render of currentRenders) {
    const baseRender = baseEntry?.renders.find(
      (r) => r.id === render.id && r.phase === render.phase,
    );
    entries.push({
      name: `${render.id}:${render.phase}`,
      value: render.actualDuration,
      stdDev: render.stdDev,
      outliers: render.outliers,
      diff: makeDiffValue(render.actualDuration, baseRender?.actualDuration ?? null),
      removed: false,
    });
  }

  // Removed renders (in base but not in current)
  if (baseEntry) {
    for (const baseRender of baseEntry.renders) {
      const exists = currentRenders.some(
        (r) => r.id === baseRender.id && r.phase === baseRender.phase,
      );
      if (!exists) {
        entries.push({
          name: `${baseRender.id}:${baseRender.phase}`,
          value: 0,
          stdDev: 0,
          outliers: 0,
          diff: makeDiffValue(null, baseRender.actualDuration),
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
 * Diff for a custom metric, honoring its definition: a metric without an `alarm` is
 * informational (always neutral), a `discrete` metric compares exactly, and a `scalar` metric
 * uses its own noise band and direction. Metrics without a definition (e.g. paint) keep the
 * default `makeDiffValue` behavior and never reach this function.
 */
function makeMetricDiff(
  current: number | null,
  base: number | null,
  definition: MetricDefinition,
): DiffValue {
  if (base === null) {
    return { current, base, absoluteDiff: 0, relativeDiff: 0, severity: 'neutral', hint: 'New' };
  }

  const currentVal = current ?? 0;
  const absoluteDiff = currentVal - base;
  const relativeDiff = base !== 0 ? absoluteDiff / base : 0;

  const { alarm, kind } = definition;
  const isDiscrete = kind === 'discrete';
  const diffStr = isDiscrete
    ? `${absoluteDiff > 0 ? '+' : ''}${absoluteDiff}`
    : `${formatDiffMs(absoluteDiff)} (${percentFormatter.format(relativeDiff)})`;

  // Informational metric: show the change, never flag it.
  if (!alarm) {
    return {
      current,
      base,
      absoluteDiff,
      relativeDiff,
      severity: 'neutral',
      hint: absoluteDiff === 0 ? 'No change' : diffStr,
    };
  }

  const withinNoise = isDiscrete
    ? absoluteDiff === 0
    : Math.abs(relativeDiff) <= (alarm.threshold ?? NOISE_THRESHOLD);
  const direction = alarm.direction ?? 'lowerIsBetter';
  const isRegression = direction === 'lowerIsBetter' ? absoluteDiff > 0 : absoluteDiff < 0;

  let severity: BenchmarkDiffSeverity = 'neutral';
  if (!withinNoise && absoluteDiff !== 0) {
    severity = isRegression ? 'error' : 'success';
  }

  let hint: string;
  if (absoluteDiff === 0) {
    hint = 'No change';
  } else if (withinNoise) {
    hint = `Within noise: ${diffStr}`;
  } else {
    hint = `${isRegression ? 'Regression' : 'Improvement'}: ${diffStr}`;
  }

  return { current, base, absoluteDiff, relativeDiff, severity, hint };
}

function compareMetrics(
  currentMetrics: Record<string, { mean: number; stdDev: number; outliers: number }>,
  baseEntry: BenchmarkReportEntry | undefined,
  definitions: Record<string, MetricDefinition> | undefined,
): ComparisonEntry[] {
  const entries: ComparisonEntry[] = [];

  for (const [name, stats] of Object.entries(currentMetrics)) {
    const definition = definitions?.[baseMetricName(name)];
    const baseStats = baseEntry?.metrics[name];
    entries.push({
      name,
      value: stats.mean,
      stdDev: stats.stdDev,
      outliers: stats.outliers,
      diff: definition
        ? makeMetricDiff(stats.mean, baseStats?.mean ?? null, definition)
        : makeDiffValue(stats.mean, baseStats?.mean ?? null),
      removed: false,
      format: definition?.format,
    });
  }

  // Removed metrics
  if (baseEntry) {
    for (const [name, baseStats] of Object.entries(baseEntry.metrics)) {
      if (!(name in currentMetrics)) {
        const definition = definitions?.[baseMetricName(name)];
        entries.push({
          name,
          value: 0,
          stdDev: 0,
          outliers: 0,
          diff: makeDiffValue(null, baseStats.mean),
          removed: true,
          format: definition?.format,
        });
      }
    }
  }

  return entries;
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

export function compareBenchmarkReports(
  current: BenchmarkReport,
  base: BenchmarkReport | null,
  definitions?: Record<string, MetricDefinition>,
): BenchmarkComparisonReport {
  const effectiveBase = base ?? {};
  const entries: ComparisonItem[] = [];

  let totalCurrentDuration = 0;
  let totalBaseDuration = 0;
  let totalCurrentRenders = 0;
  let totalBaseRenders = 0;
  let totalCurrentPaint = 0;
  let totalBasePaint = 0;
  let hasPaint = false;

  // Process current entries
  for (const [name, entry] of Object.entries(current)) {
    const baseEntry = effectiveBase[name];

    const duration = makeDiffValue(entry.totalDuration, baseEntry?.totalDuration ?? null);
    entries.push({
      name,
      duration,
      renderCount: baseEntry
        ? makeCountDiffValue(entry.renders.length, baseEntry.renders.length)
        : undefined,
      renders: compareRenders(entry.renders, baseEntry),
      metrics: compareMetrics(entry.metrics, baseEntry, definitions),
      iterations: entry.iterations,
    });

    totalCurrentDuration += entry.totalDuration;
    totalBaseDuration += baseEntry?.totalDuration ?? 0;
    totalCurrentRenders += entry.renders.length;
    totalBaseRenders += baseEntry?.renders.length ?? 0;

    const paintMetric = entry.metrics['paint:default'];
    const basePaintMetric = baseEntry?.metrics['paint:default'];
    if (paintMetric || basePaintMetric) {
      hasPaint = true;
      totalCurrentPaint += paintMetric?.mean ?? 0;
      totalBasePaint += basePaintMetric?.mean ?? 0;
    }
  }

  // Process removed entries (in base but not in current)
  for (const [name, baseEntry] of Object.entries(effectiveBase)) {
    if (name in current) {
      continue;
    }

    const duration = makeDiffValue(null, baseEntry.totalDuration);
    entries.push({
      name,
      duration,
      renders: compareRenders([], baseEntry),
      metrics: compareMetrics({}, baseEntry, definitions),
      iterations: 0,
    });

    totalBaseDuration += baseEntry.totalDuration;
    totalBaseRenders += baseEntry.renders.length;

    const basePaintMetric = baseEntry.metrics['paint:default'];
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
      duration: makeDiffValue(totalCurrentDuration, totalBaseDuration),
      renderCount: makeCountDiffValue(totalCurrentRenders, totalBaseRenders),
      paintDefault: hasPaint ? makeDiffValue(totalCurrentPaint, totalBasePaint) : null,
    },
  };
}
