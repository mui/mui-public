import type { BenchmarkReport, BenchmarkReportEntry, RenderStats } from './fetchBenchmarkReport';
import { formatMs, formatDiffMs, percentFormatter } from './formatters';

export type BenchmarkDiffSeverity = 'error' | 'success' | 'neutral';

export interface DiffValue {
  current: number | null;
  base: number | null;
  absoluteDiff: number;
  relativeDiff: number;
  severity: BenchmarkDiffSeverity;
  hint: string;
}

export interface ComparisonItem {
  name: string;
  duration: DiffValue;
  renderCount?: DiffValue;
  children?: ComparisonItem[];
}

export interface BenchmarkComparisonReport {
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
  const currentVal = current ?? 0;
  const baseVal = base ?? 0;
  const absoluteDiff = currentVal - baseVal;
  const relativeDiff = baseVal !== 0 ? absoluteDiff / baseVal : 0;
  const combinedStdDev = baseStdDev + currentStdDev;
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
): ComparisonItem[] {
  const items: ComparisonItem[] = [];

  for (const render of currentRenders) {
    const baseRender = baseEntry?.renders.find(
      (r) => r.id === render.id && r.phase === render.phase,
    );
    items.push({
      name: `${render.id}:${render.phase}`,
      duration: makeDiffValue(
        render.actualDuration,
        baseRender?.actualDuration ?? null,
        render.stdDev,
        baseRender?.stdDev ?? 0,
      ),
    });
  }

  // Removed renders (in base but not in current)
  if (baseEntry) {
    for (const baseRender of baseEntry.renders) {
      const exists = currentRenders.some(
        (r) => r.id === baseRender.id && r.phase === baseRender.phase,
      );
      if (!exists) {
        items.push({
          name: `${baseRender.id}:${baseRender.phase}`,
          duration: makeDiffValue(null, baseRender.actualDuration, 0, baseRender.stdDev),
        });
      }
    }
  }

  return items;
}

function compareMetrics(
  currentMetrics: Record<string, { mean: number; stdDev: number; outliers: number }>,
  baseEntry: BenchmarkReportEntry | undefined,
): ComparisonItem[] {
  const items: ComparisonItem[] = [];

  for (const [name, stats] of Object.entries(currentMetrics)) {
    const baseStats = baseEntry?.metrics[name];
    items.push({
      name,
      duration: makeDiffValue(
        stats.mean,
        baseStats?.mean ?? null,
        stats.stdDev,
        baseStats?.stdDev ?? 0,
      ),
    });
  }

  // Removed metrics
  if (baseEntry) {
    for (const [name, baseStats] of Object.entries(baseEntry.metrics)) {
      if (!(name in currentMetrics)) {
        items.push({
          name,
          duration: makeDiffValue(null, baseStats.mean, 0, baseStats.stdDev),
        });
      }
    }
  }

  return items;
}

function sortByRegression(entries: ComparisonItem[]): ComparisonItem[] {
  return [...entries].sort((a, b) => {
    const aRel = a.duration.relativeDiff;
    const bRel = b.duration.relativeDiff;
    const aIsRegression = aRel > 0;
    const bIsRegression = bRel > 0;
    if (aIsRegression !== bIsRegression) {
      return aIsRegression ? -1 : 1;
    }
    return Math.abs(bRel) - Math.abs(aRel);
  });
}

export function compareBenchmarkReports(
  current: BenchmarkReport,
  base: BenchmarkReport,
): BenchmarkComparisonReport {
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
    const baseEntry = base[name];

    const children = [
      ...compareRenders(entry.renders, baseEntry),
      ...compareMetrics(entry.metrics, baseEntry),
    ];

    entries.push({
      name,
      duration: makeDiffValue(entry.totalDuration, baseEntry?.totalDuration ?? null, 0, 0),
      renderCount: makeCountDiffValue(entry.renders.length, baseEntry?.renders.length ?? 0),
      children,
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
  for (const [name, baseEntry] of Object.entries(base)) {
    if (name in current) {
      continue;
    }

    const children = [...compareRenders([], baseEntry), ...compareMetrics({}, baseEntry)];

    entries.push({
      name,
      duration: makeDiffValue(null, baseEntry.totalDuration, 0, 0),
      renderCount: makeCountDiffValue(0, baseEntry.renders.length),
      children,
    });

    totalBaseDuration += baseEntry.totalDuration;
    totalBaseRenders += baseEntry.renders.length;

    const basePaintMetric = baseEntry.metrics['paint:default'];
    if (basePaintMetric) {
      hasPaint = true;
      totalBasePaint += basePaintMetric.mean;
    }
  }

  const sorted = sortByRegression(entries);

  return {
    entries: sorted,
    totals: {
      duration: makeDiffValue(totalCurrentDuration, totalBaseDuration, 0, 0),
      renderCount: makeCountDiffValue(totalCurrentRenders, totalBaseRenders),
      paintDefault: hasPaint ? makeDiffValue(totalCurrentPaint, totalBasePaint, 0, 0) : null,
    },
  };
}
