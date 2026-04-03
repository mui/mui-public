import type { BenchmarkComparisonReport, DiffValue } from './compareBenchmarkReports';
import { formatDiffMs, percentFormatter } from './formatters';

export interface BuildMarkdownReportOptions {
  maxRows?: number;
  reportUrl?: string;
}

const SEVERITY_PREFIX: Record<string, string> = {
  error: '\uD83D\uDD3A',
  success: '\u25BC',
};

function formatDiffCell(diff: DiffValue, unit: 'ms' | 'count'): string {
  if (diff.absoluteDiff === 0) {
    return unit === 'ms' ? '0 ms' : '0';
  }

  const prefix = SEVERITY_PREFIX[diff.severity] ?? '';

  if (unit === 'ms') {
    const value = formatDiffMs(diff.absoluteDiff);
    const pct = percentFormatter.format(diff.relativeDiff);
    return `${prefix}${value}<sup>(${pct})</sup>`;
  }

  const sign = diff.absoluteDiff > 0 ? '+' : '';
  return `${prefix}${sign}${diff.absoluteDiff}`;
}

function formatTotalItem(label: string, diff: DiffValue, unit: 'ms' | 'count'): string {
  return `**${label}:** ${formatDiffCell(diff, unit)}`;
}

export function buildBenchmarkMarkdownReport(
  report: BenchmarkComparisonReport,
  options?: BuildMarkdownReportOptions,
): string {
  const maxRows = options?.maxRows ?? 5;
  const reportUrl = options?.reportUrl;

  const lines: string[] = [];

  // Totals summary
  const totalParts = [
    formatTotalItem('Total duration', report.totals.duration, 'ms'),
    formatTotalItem('Renders', report.totals.renderCount, 'count'),
  ];
  if (report.totals.paintDefault) {
    totalParts.push(formatTotalItem('Paint', report.totals.paintDefault, 'ms'));
  }
  lines.push(totalParts.join(' | '));
  lines.push('');

  // Table header
  lines.push('| Test | Duration | Renders |');
  lines.push('|:-----|----------:|--------:|');

  const entries = report.entries;
  const visibleEntries = entries.slice(0, maxRows);
  const remaining = entries.length - visibleEntries.length;

  for (const entry of visibleEntries) {
    const name = entry.duration.current === null ? `~~${entry.name}~~ (removed)` : entry.name;
    const duration = formatDiffCell(entry.duration, 'ms');
    const renders = entry.renderCount ? formatDiffCell(entry.renderCount, 'count') : '';
    lines.push(`| ${name} | ${duration} | ${renders} |`);
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
