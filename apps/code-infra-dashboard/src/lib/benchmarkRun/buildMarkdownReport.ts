import { formatMarkdownTable } from '@/utils/formatters';
import {
  analyzeRun,
  benchmarkTable,
  changeTone,
  findRegressions,
  formatDuration,
  formatRounds,
  formatComparison,
  formatRunSummary,
  runReportFootnote,
} from '@mui/internal-benchmark/runReport';
import type {
  BenchmarkAnalysis,
  BenchmarkRunReport,
  BenchmarkTableColumn,
  BenchmarkTableRow,
  ChangeTone,
} from '@mui/internal-benchmark/runReport';

interface BuildOptions {
  /** The comment section's heading. */
  title: string;
  /** Where the full results can be inspected. Omitted in tests. */
  detailsUrl?: string;
}

const TONE_MARKERS: Record<ChangeTone, string> = {
  error: '🔴 ',
  warning: '🟠 ',
  success: '🟢 ',
  none: '',
};

/** The rows of a benchmark's table that changed — better or worse — with their columns. */
function changedRowsOf(analysis: BenchmarkAnalysis) {
  const { columns, rows } = benchmarkTable(analysis);
  const changed = rows.filter((row) =>
    row.comparisons.some(({ change }) => change === 'better' || change === 'worse'),
  );
  return { columns, changed };
}

/** A row's cells for markdown: each comparison as code, behind a marker of which way it went. */
function markdownCells(columns: BenchmarkTableColumn[], row: BenchmarkTableRow): string[] {
  const firstComparison = columns.findIndex((column) => column.kind === 'comparison');
  return row.cells.map((cell, column) => {
    if (columns[column].kind !== 'comparison') {
      return cell;
    }
    return `${TONE_MARKERS[changeTone(row.comparisons[column - firstComparison])]}\`${cell}\``;
  });
}

function markdownTable(
  headers: string[],
  kinds: Array<BenchmarkTableColumn['kind']>,
  rows: string[][],
) {
  return formatMarkdownTable(
    headers.map((header, column) => ({
      field: String(column),
      header,
      align: kinds[column] === 'value' ? ('right' as const) : ('left' as const),
    })),
    rows.map((cells) => Object.fromEntries(cells.map((cell, column) => [String(column), cell]))),
  );
}

/**
 * The benchmarks measured against the baseline, as one table of the metrics that changed, so the
 * columns line up across benchmarks; those where nothing changed are named below it.
 */
function renderBaselineChanges(analyses: BenchmarkAnalysis[]): string[] {
  const lines: string[] = [];
  const unchanged: string[] = [];
  let header: { headers: string[]; kinds: Array<BenchmarkTableColumn['kind']> } | undefined;
  const rows: string[][] = [];
  for (const analysis of analyses) {
    const { name, durationMs } = analysis.benchmark;
    const label =
      durationMs === undefined ? `**${name}**` : `**${name}** (${formatDuration(durationMs)})`;
    const { columns, changed } = changedRowsOf(analysis);
    if (changed.length === 0) {
      unchanged.push(label);
      continue;
    }
    header ??= {
      headers: ['Benchmark', ...columns.map((column) => column.header)],
      kinds: ['label', ...columns.map((column) => column.kind)],
    };
    changed.forEach((row, index) => {
      rows.push([index === 0 ? label : '', ...markdownCells(columns, row)]);
    });
  }
  if (header) {
    lines.push(markdownTable(header.headers, header.kinds, rows), '');
  }
  if (unchanged.length > 0) {
    lines.push(`No change detected: ${unchanged.join(', ')}`, '');
  }
  return lines;
}

/** A `compare()` benchmark: a table of the metrics that changed, or one line when none did. */
function renderComparison(analysis: BenchmarkAnalysis): string {
  const heading = `**${analysis.benchmark.name}** · ${formatRounds(analysis.benchmark)}`;
  const { columns, changed } = changedRowsOf(analysis);
  if (changed.length === 0) {
    return `${heading} · no change detected`;
  }
  const table = markdownTable(
    columns.map((column) => column.header),
    columns.map((column) => column.kind),
    changed.map((row) => markdownCells(columns, row)),
  );
  return `${heading}\n\n${table}`;
}

/**
 * Renders a version 2 benchmark report as its pull request comment section.
 *
 * Regressions are stated above the collapsed block, and mark the heading, because a reader has to
 * see them without expanding anything — GitHub renders `<details>` closed, so anything inside it is
 * invisible until someone chooses to look.
 */
export function buildBenchmarkRunMarkdownReport(
  report: BenchmarkRunReport,
  options: BuildOptions,
): string {
  const analyses = analyzeRun(report);
  const regressions = findRegressions(analyses);
  const measured = analyses.filter((analysis) => !analysis.benchmark.error);
  const failed = analyses.filter((analysis) => analysis.benchmark.error);

  const lines = [`## ${options.title}${regressions.length > 0 ? ' ⚠️' : ''}`, ''];

  for (const { benchmark, metric, comparison } of regressions) {
    const marker = comparison.severity === 'error' ? '🔴' : '🟡';
    lines.push(`${marker} **${benchmark}** · ${metric} · \`${formatComparison(comparison)}\``);
  }
  if (regressions.length > 0) {
    lines.push('');
  }

  lines.push(formatRunSummary(analyses, regressions, report.durationMs), '');

  for (const { benchmark } of failed) {
    lines.push(`❌ **${benchmark.name}**: ${benchmark.error}`);
  }
  if (failed.length > 0) {
    lines.push('');
  }

  if (measured.length > 0) {
    lines.push('<details>', '<summary>Changes</summary>', '');
    lines.push(
      ...renderBaselineChanges(
        measured.filter((analysis) => analysis.benchmark.kind === 'baseline'),
      ),
    );
    const comparisons = measured.filter((analysis) => analysis.benchmark.kind === 'compare');
    if (comparisons.length > 0) {
      lines.push(comparisons.map(renderComparison).join('\n\n'), '');
    }
    lines.push(`_${runReportFootnote(analyses)}_`, '', '</details>');
  }

  if (options.detailsUrl) {
    lines.push('', `[See the full run](${options.detailsUrl})`);
  }

  return lines.join('\n');
}
