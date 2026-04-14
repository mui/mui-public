import { formatMs, formatDiffMs, percentFormatter } from '@/utils/formatters';
import type { BenchmarkReport, BenchmarkReportEntry, RenderStats } from './types';

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
}

export interface ComparisonItem {
  name: string;
  duration: DiffValue;
  renderCount?: DiffValue;
  renders: ComparisonEntry[];
  metrics: ComparisonEntry[];
  iterations: number;
  /**
   * Precomputed sort priority. Lower values come first. Encodes severity (error →
   * success → neutral) and, within each severity, larger absolute diff first.
   */
  priority: number;
}

const SEVERITY_RANK: Record<BenchmarkDiffSeverity, number> = {
  error: 0,
  success: 1,
  neutral: 2,
};

// Large enough that any realistic magnitude (ms) stays inside a single severity bucket.
const PRIORITY_SEVERITY_SCALE = 1e15;

function makePriority(duration: DiffValue): number {
  return (
    SEVERITY_RANK[duration.severity] * PRIORITY_SEVERITY_SCALE - Math.abs(duration.absoluteDiff)
  );
}

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

function buildHint(
  absoluteDiff: number,
  relativeDiff: number,
  withinNoise: boolean,
  combinedStdDev: number,
): string {
  if (absoluteDiff === 0) {
    return 'No change';
  }
  const diffStr = `${formatDiffMs(absoluteDiff)} (${percentFormatter.format(relativeDiff)})`;
  if (withinNoise) {
    return `Within noise: ${diffStr}, combined std dev ${formatMs(combinedStdDev)}`;
  }
  if (absoluteDiff > 0) {
    return `Regression: ${diffStr}`;
  }
  return `Improvement: ${diffStr}`;
}

function makeDiffValue(
  current: number | null,
  base: number | null,
  currentStdDev: number,
  baseStdDev: number,
): DiffValue {
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
  const combinedStdDev = Math.hypot(baseStdDev, currentStdDev);
  const withinNoise = Math.abs(absoluteDiff) <= combinedStdDev;
  return {
    current,
    base,
    absoluteDiff,
    relativeDiff,
    severity: computeSeverity(absoluteDiff, withinNoise),
    hint: buildHint(absoluteDiff, relativeDiff, withinNoise, combinedStdDev),
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
      diff: makeDiffValue(
        render.actualDuration,
        baseRender?.actualDuration ?? null,
        render.stdDev,
        baseRender?.stdDev ?? 0,
      ),
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
          diff: makeDiffValue(null, baseRender.actualDuration, 0, baseRender.stdDev),
          removed: true,
        });
      }
    }
  }

  return entries;
}

function compareMetrics(
  currentMetrics: Record<string, { mean: number; stdDev: number; outliers: number }>,
  baseEntry: BenchmarkReportEntry | undefined,
): ComparisonEntry[] {
  const entries: ComparisonEntry[] = [];

  for (const [name, stats] of Object.entries(currentMetrics)) {
    const baseStats = baseEntry?.metrics[name];
    entries.push({
      name,
      value: stats.mean,
      stdDev: stats.stdDev,
      outliers: stats.outliers,
      diff: makeDiffValue(
        stats.mean,
        baseStats?.mean ?? null,
        stats.stdDev,
        baseStats?.stdDev ?? 0,
      ),
      removed: false,
    });
  }

  // Removed metrics
  if (baseEntry) {
    for (const [name, baseStats] of Object.entries(baseEntry.metrics)) {
      if (!(name in currentMetrics)) {
        entries.push({
          name,
          value: 0,
          stdDev: 0,
          outliers: 0,
          diff: makeDiffValue(null, baseStats.mean, 0, baseStats.stdDev),
          removed: true,
        });
      }
    }
  }

  return entries;
}

function sortByPriority(entries: ComparisonItem[]): ComparisonItem[] {
  return [...entries].sort((a, b) => a.priority - b.priority);
}

export function compareBenchmarkReports(
  current: BenchmarkReport,
  base: BenchmarkReport | null,
): BenchmarkComparisonReport {
  const effectiveBase = base ?? {};
  const entries: ComparisonItem[] = [];

  let totalCurrentDuration = 0;
  let totalBaseDuration = 0;
  const currentDurationStdDevs: number[] = [];
  const baseDurationStdDevs: number[] = [];
  let totalCurrentRenders = 0;
  let totalBaseRenders = 0;
  let totalCurrentPaint = 0;
  let totalBasePaint = 0;
  const currentPaintStdDevs: number[] = [];
  const basePaintStdDevs: number[] = [];
  let hasPaint = false;

  // Process current entries
  for (const [name, entry] of Object.entries(current)) {
    const baseEntry = effectiveBase[name];

    const duration = makeDiffValue(entry.totalDuration, baseEntry?.totalDuration ?? null, 0, 0);
    entries.push({
      name,
      duration,
      renderCount: makeCountDiffValue(entry.renders.length, baseEntry?.renders.length ?? 0),
      renders: compareRenders(entry.renders, baseEntry),
      metrics: compareMetrics(entry.metrics, baseEntry),
      iterations: entry.iterations,
      priority: makePriority(duration),
    });

    totalCurrentDuration += entry.totalDuration;
    totalBaseDuration += baseEntry?.totalDuration ?? 0;
    for (const render of entry.renders) {
      currentDurationStdDevs.push(render.stdDev);
    }
    if (baseEntry) {
      for (const render of baseEntry.renders) {
        baseDurationStdDevs.push(render.stdDev);
      }
    }
    totalCurrentRenders += entry.renders.length;
    totalBaseRenders += baseEntry?.renders.length ?? 0;

    const paintMetric = entry.metrics['paint:default'];
    const basePaintMetric = baseEntry?.metrics['paint:default'];
    if (paintMetric || basePaintMetric) {
      hasPaint = true;
      totalCurrentPaint += paintMetric?.mean ?? 0;
      totalBasePaint += basePaintMetric?.mean ?? 0;
      if (paintMetric) {
        currentPaintStdDevs.push(paintMetric.stdDev);
      }
      if (basePaintMetric) {
        basePaintStdDevs.push(basePaintMetric.stdDev);
      }
    }
  }

  // Process removed entries (in base but not in current)
  for (const [name, baseEntry] of Object.entries(effectiveBase)) {
    if (name in current) {
      continue;
    }

    const duration = makeDiffValue(null, baseEntry.totalDuration, 0, 0);
    entries.push({
      name,
      duration,
      renderCount: makeCountDiffValue(0, baseEntry.renders.length),
      renders: compareRenders([], baseEntry),
      metrics: compareMetrics({}, baseEntry),
      iterations: 0,
      priority: makePriority(duration),
    });

    totalBaseDuration += baseEntry.totalDuration;
    for (const render of baseEntry.renders) {
      baseDurationStdDevs.push(render.stdDev);
    }
    totalBaseRenders += baseEntry.renders.length;

    const basePaintMetric = baseEntry.metrics['paint:default'];
    if (basePaintMetric) {
      hasPaint = true;
      totalBasePaint += basePaintMetric.mean;
      basePaintStdDevs.push(basePaintMetric.stdDev);
    }
  }

  const sorted = sortByPriority(entries);

  return {
    hasBase: base !== null,
    entries: sorted,
    totals: {
      duration: makeDiffValue(
        totalCurrentDuration,
        totalBaseDuration,
        Math.hypot(...currentDurationStdDevs),
        Math.hypot(...baseDurationStdDevs),
      ),
      renderCount: makeCountDiffValue(totalCurrentRenders, totalBaseRenders),
      paintDefault: hasPaint
        ? makeDiffValue(
            totalCurrentPaint,
            totalBasePaint,
            Math.hypot(...currentPaintStdDevs),
            Math.hypot(...basePaintStdDevs),
          )
        : null,
    },
  };
}
