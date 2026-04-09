import { formatMs, formatDiffMs, percentFormatter } from '@/utils/formatters';
import type { BenchmarkComparisonReport, DiffValue } from './compareBenchmarkReports';

export interface BuildMarkdownReportOptions {
  maxRows?: number;
  reportUrl?: string;
}

const SEVERITY_PREFIX: Record<string, string> = {
  error: '\uD83D\uDD3A',
  success: '\u25BC',
};

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

  // Table header
  lines.push('| Test | Duration | Renders |');
  lines.push('|:-----|----------:|--------:|');

  const entries = report.entries;
  const visibleEntries = entries.slice(0, maxRows);
  const remaining = entries.length - visibleEntries.length;

  for (const entry of visibleEntries) {
    const renderCount = entry.renders.filter((r) => !r.removed).length;

    if (entry.duration.current === null) {
      lines.push(`| ~~${entry.name}~~ (removed) | \u2014 | \u2014 |`);
      continue;
    }

    const duration = `${formatMs(entry.duration.current)}${report.hasBase ? formatDiff(entry.duration, 'ms') : ''}`;
    const renders = `${renderCount}${report.hasBase && entry.renderCount ? formatDiff(entry.renderCount, 'count') : ''}`;
    lines.push(`| ${entry.name} | ${duration} | ${renders} |`);
  }

  if (remaining > 0) {
    const moreText = `...and ${remaining} more`;
    if (reportUrl) {
      lines.push('');
      lines.push(`*${moreText}. [View full report](${reportUrl})*`);
    } else {
      lines.push('');
      lines.push(`*${moreText}.*`);
    }
  }

  return lines.join('\n');
}
