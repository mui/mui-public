import { formatMarkdownTable } from '@/utils/formatters';
import {
  analyzeRun,
  benchmarkTable,
  changeTone,
  findRegressions,
  formatRounds,
  formatComparison,
  formatRunSummary,
  runReportFootnote,
} from '@mui/internal-benchmark/runReport';
import type {
  BenchmarkAnalysis,
  BenchmarkRunReport,
  BenchmarkTableColumn,
  ChangeTone,
  RunBenchmark,
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

/** A benchmark's name, with how many rounds it ran and how long it took. */
function labelOf(benchmark: RunBenchmark): string {
  const rounds = formatRounds(benchmark);
  return rounds ? `**${benchmark.name}** (${rounds})` : `**${benchmark.name}**`;
}

/**
 * A benchmark's table, keeping the rows that changed — better or worse — as markdown cells: each
 * comparison as code, behind a marker of which way it went.
 */
function changedRowsOf(analysis: BenchmarkAnalysis): {
  columns: BenchmarkTableColumn[];
  rows: string[][];
} {
  const { columns, rows } = benchmarkTable(analysis);
  const firstComparison = columns.findIndex((column) => column.kind === 'comparison');
  const changed = rows.filter((row) =>
    row.comparisons.some(({ change }) => change === 'better' || change === 'worse'),
  );
  return {
    columns,
    rows: changed.map((row) =>
      row.cells.map((cell, column) =>
        columns[column].kind === 'comparison'
          ? `${TONE_MARKERS[changeTone(row.comparisons[column - firstComparison])]}\`${cell}\``
          : cell,
      ),
    ),
  };
}

function markdownTable(columns: BenchmarkTableColumn[], rows: string[][]): string {
  return formatMarkdownTable(
    columns.map(({ header, kind }, column) => ({
      field: String(column),
      header,
      align: kind === 'value' ? ('right' as const) : ('left' as const),
    })),
    rows.map((cells) => Object.fromEntries(cells.map((cell, column) => [String(column), cell]))),
  );
}

/**
 * The benchmarks measured against the baseline, as one table of the metrics that changed, so the
 * columns line up across benchmarks; those where nothing changed are named below it.
 */
function renderBaselineChanges(analyses: BenchmarkAnalysis[]): string[] {
  const tables = analyses.map((analysis) => ({ analysis, ...changedRowsOf(analysis) }));
  const changed = tables.filter((table) => table.rows.length > 0);
  const unchanged = tables.filter((table) => table.rows.length === 0);
  const lines: string[] = [];
  if (changed.length > 0) {
    const columns: BenchmarkTableColumn[] = [
      { header: 'Benchmark', kind: 'label' },
      ...changed[0].columns,
    ];
    const rows = changed.flatMap(({ analysis, rows: cells }) =>
      cells.map((row, index) => [index === 0 ? labelOf(analysis.benchmark) : '', ...row]),
    );
    lines.push(markdownTable(columns, rows), '');
  }
  if (unchanged.length > 0) {
    const names = unchanged.map(({ analysis }) => labelOf(analysis.benchmark));
    lines.push(`No change detected: ${names.join(', ')}`, '');
  }
  return lines;
}

/** A `compare()` benchmark: a table of the metrics that changed, or one line when none did. */
function renderComparison(analysis: BenchmarkAnalysis): string {
  const { columns, rows } = changedRowsOf(analysis);
  return rows.length === 0
    ? `${labelOf(analysis.benchmark)} · no change detected`
    : `${labelOf(analysis.benchmark)}\n\n${markdownTable(columns, rows)}`;
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
