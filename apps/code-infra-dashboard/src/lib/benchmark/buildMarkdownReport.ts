import { formatMs, formatDiffMs, percentFormatter } from '@/utils/formatters';
import type {
  BenchmarkComparisonReport,
  ComparisonItem,
  DiffValue,
} from './compareBenchmarkReports';

export interface BuildMarkdownReportOptions {
  maxRows?: number;
  reportUrl?: string;
}

const SEVERITY_PREFIX: Record<string, string> = {
  error: '🔺',
  success: '▼',
};

const TABLE_HEADER = ['| Test | Duration | Renders |', '|:-----|----------:|--------:|'];

const REMOVED_CELL = '—';

type EntryClass = 'regression' | 'improvement' | 'addedRemoved' | 'neutral';

/**
 * Buckets an entry into one of the report sections. Tests with no current
 * value (removed) or no baseline (added) have no diff to compare, so they
 * share an "added & removed" section; otherwise the worst severity across
 * duration and render count decides. Everything else is "no change" and only
 * surfaces via the details link.
 */
function classifyEntry(entry: ComparisonItem): EntryClass {
  if (entry.duration.current === null || entry.duration.base === null) {
    return 'addedRemoved';
  }
  const severities = [entry.duration.severity, entry.renderCount?.severity ?? 'neutral'];
  if (severities.includes('error')) {
    return 'regression';
  }
  if (severities.includes('success')) {
    return 'improvement';
  }
  return 'neutral';
}

function formatDiff(diff: DiffValue, unit: 'ms' | 'count'): string {
  const prefix = SEVERITY_PREFIX[diff.severity] ?? '';

  if (unit === 'ms') {
    if (diff.absoluteDiff === 0) {
      return '';
    }
    const value = formatDiffMs(diff.absoluteDiff);
    const pct = percentFormatter.format(diff.relativeDiff);
    return ` ${prefix}${value}<sup>(${pct})</sup>`;
  }

  const sign = diff.absoluteDiff >= 0 ? '+' : '';
  return ` <sup>(${prefix}${sign}${diff.absoluteDiff})</sup>`;
}

export function buildBenchmarkMarkdownReport(
  report: BenchmarkComparisonReport,
  options?: BuildMarkdownReportOptions,
): string {
  const maxRows = options?.maxRows ?? 5;
  const reportUrl = options?.reportUrl;

  const lines: string[] = [];

  // Totals summary
  if (report.hasBase) {
    const totalParts = [
      `**Total duration:** ${formatMs(report.totals.duration.current ?? 0)}${formatDiff(report.totals.duration, 'ms')}`,
      `**Renders:** ${report.totals.renderCount.current ?? 0}${formatDiff(report.totals.renderCount, 'count')}`,
    ];
    if (report.totals.paintDefault) {
      totalParts.push(
        `**Paint:** ${formatMs(report.totals.paintDefault.current ?? 0)}${formatDiff(report.totals.paintDefault, 'ms')}`,
      );
    }
    lines.push(totalParts.join(' | '));
    lines.push('');
  }

  const detailsLink = reportUrl ? `[details](${reportUrl})` : '';
  const suffix = detailsLink ? ` — ${detailsLink}` : '';

  const renderRow = (entry: ComparisonItem): string => {
    const renderCount = entry.renders.filter((render) => !render.removed).length;

    if (entry.duration.current === null) {
      return `| ~~${entry.name}~~ (removed) | ${REMOVED_CELL} | ${REMOVED_CELL} |`;
    }

    const duration = `${formatMs(entry.duration.current)}${report.hasBase ? formatDiff(entry.duration, 'ms') : ''}`;
    const renders = `${renderCount}${report.hasBase && entry.renderCount ? formatDiff(entry.renderCount, 'count') : ''}`;
    return `| ${entry.name} | ${duration} | ${renders} |`;
  };

  // Without a baseline there is nothing to compare against — emit a single
  // plain table of every entry, no sections and no diff columns.
  if (!report.hasBase) {
    lines.push(...TABLE_HEADER);
    const visibleEntries = report.entries.slice(0, maxRows);
    for (const entry of visibleEntries) {
      lines.push(renderRow(entry));
    }
    const hidden = report.entries.length - visibleEntries.length;
    lines.push('');
    if (hidden > 0) {
      lines.push(`*…and ${hidden} more${suffix}*`);
    } else if (detailsLink) {
      lines.push(detailsLink);
    }
    return lines.join('\n');
  }

  const regressions = report.entries.filter((entry) => classifyEntry(entry) === 'regression');
  const improvements = report.entries.filter((entry) => classifyEntry(entry) === 'improvement');
  const addedRemoved = report.entries.filter((entry) => classifyEntry(entry) === 'addedRemoved');
  const significant = [...regressions, ...improvements, ...addedRemoved];
  const noChange = report.entries.length - significant.length;

  if (significant.length === 0) {
    lines.push(`*No significant changes${suffix}*`);
    return lines.join('\n');
  }

  // Shared row budget across both sections — regressions first since they
  // matter most, improvements fill whatever budget is left.
  const visibleEntries = significant.slice(0, maxRows);
  const hiddenSignificant = significant.length - visibleEntries.length;
  const visibleRegressions = visibleEntries.filter(
    (entry) => classifyEntry(entry) === 'regression',
  );
  const visibleImprovements = visibleEntries.filter(
    (entry) => classifyEntry(entry) === 'improvement',
  );
  const visibleAddedRemoved = visibleEntries.filter(
    (entry) => classifyEntry(entry) === 'addedRemoved',
  );

  const renderSection = (title: string, entries: ComparisonItem[]) => {
    if (entries.length === 0) {
      return;
    }
    lines.push(`#### ${title}`);
    lines.push('');
    lines.push(...TABLE_HEADER);
    for (const entry of entries) {
      lines.push(renderRow(entry));
    }
    lines.push('');
  };

  renderSection('🔺 Regressions', visibleRegressions);
  renderSection('▼ Improvements', visibleImprovements);
  renderSection('➕ Added & removed', visibleAddedRemoved);

  if (hiddenSignificant > 0) {
    const noiseSuffix = noChange > 0 ? ` (+${noChange} within noise)` : '';
    lines.push(`*…and ${hiddenSignificant} more${noiseSuffix}${suffix}*`);
  } else if (noChange > 0) {
    const label = noChange === 1 ? 'test' : 'tests';
    lines.push(`*${noChange} ${label} within noise${suffix}*`);
  } else if (detailsLink) {
    lines.push(detailsLink);
  }

  return lines.join('\n');
}
