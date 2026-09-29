import { formatMarkdownTable } from '@/utils/formatters';
import type {
  ConfidenceInterval,
  TachometerReport,
} from '@mui/internal-benchmark/tachometerReport';
import {
  formatMean,
  formatPercent,
  formatSignedMs,
  isSummarized,
  shortNameOf,
} from '@mui/internal-benchmark/tachometerFormat';
import type { SummarizedCase } from '@mui/internal-benchmark/tachometerFormat';

export const TACHOMETER_SECTION_TITLE = 'Tachometer';

interface Regression {
  caseName: string;
  measurement: string;
  variant: string;
  percentChange: ConfidenceInterval;
  absoluteMs: ConfidenceInterval;
}

interface BuildOptions {
  /** Where the full results can be inspected. Omitted in tests. */
  detailsUrl?: string;
}

/**
 * The comparisons that say something about this pull request.
 *
 * Only a case measuring the working tree against the baseline does. One comparing pages built from
 * the same tree — this library against another — is a standing measurement, and a difference there
 * is the point rather than a regression.
 */
function baselineComparisons(entry: SummarizedCase) {
  if (entry.comparison !== 'baseline') {
    return [];
  }
  return entry.measurements.flatMap((measurement) =>
    measurement.comparisons.map((comparison) => ({ measurement, comparison })),
  );
}

export function findRegressions(report: TachometerReport): Regression[] {
  const regressions: Regression[] = [];

  for (const entry of report.cases) {
    if (!isSummarized(entry)) {
      continue;
    }
    for (const { measurement, comparison } of baselineComparisons(entry)) {
      if (comparison.verdict === 'slower') {
        regressions.push({
          caseName: entry.name,
          measurement: measurement.name,
          variant: shortNameOf(entry.name, comparison.variant),
          percentChange: comparison.percentChange,
          absoluteMs: comparison.absoluteMs,
        });
      }
    }
  }

  return regressions;
}

/** One flat table per case: every measurement, every variant, every number the report holds. */
function renderCaseTable(entry: SummarizedCase): string {
  const rows = entry.measurements.flatMap((measurement) => {
    const byVariant = new Map(
      measurement.comparisons.map((comparison) => [comparison.variant, comparison]),
    );
    return measurement.variants.map((variant) => {
      const againstReference = byVariant.get(variant.variant)?.versusReference;
      let versus = '—';
      if (variant.variant === entry.reference) {
        versus = '_reference_';
      } else if (againstReference) {
        versus = `${againstReference.verdict} \`${formatPercent(againstReference.percentChange)}\``;
      }
      return {
        measurement: measurement.name,
        variant: shortNameOf(entry.name, variant.variant),
        mean: formatMean(variant.meanMs),
        versus,
        samples: variant.samples,
      };
    });
  });

  return `**${entry.name}**\n\n${formatMarkdownTable(
    [
      { field: 'measurement', header: 'Measurement', align: 'left' },
      { field: 'variant', header: 'Variant', align: 'left' },
      { field: 'mean', header: 'Mean (95% CI)', align: 'right' },
      { field: 'versus', header: 'vs reference', align: 'left' },
      { field: 'samples', header: 'Samples', align: 'right' },
    ],
    rows,
  )}`;
}

/**
 * Renders the tachometer section of the pull request comment.
 *
 * Regressions are stated above the collapsed block, and mark the heading, because a reader has to
 * see them without expanding anything — GitHub renders `<details>` closed, so anything inside it is
 * invisible until someone chooses to look.
 */
export function buildTachometerMarkdownReport(
  report: TachometerReport,
  options: BuildOptions = {},
): string {
  const regressions = findRegressions(report);
  const summarized = report.cases.filter(isSummarized);
  const failed = report.cases.filter((entry) => !isSummarized(entry));

  const heading = `## ${TACHOMETER_SECTION_TITLE}${regressions.length > 0 ? ' ⚠️' : ''}`;
  const lines = [heading, ''];

  if (regressions.length > 0) {
    for (const regression of regressions) {
      lines.push(
        `⚠️ **${regression.caseName}** · ${regression.measurement} · slower than ` +
          `${regression.variant} \`${formatPercent(regression.percentChange)}\` ` +
          `(\`${formatSignedMs(regression.absoluteMs)}\`)`,
      );
    }
    lines.push('');
  }

  // Everything that did not regress collapses to a single line, so the regressions are what the eye
  // lands on. `unsure` is the expected result for two equivalent builds, not a warning. Counted in
  // cases, like the total beside them, and over the same baseline comparisons a regression is read
  // from — a case that beats a competing library has not got faster.
  const regressedCases = new Set(regressions.map((regression) => regression.caseName));
  const faster = summarized.filter(
    (entry) =>
      !regressedCases.has(entry.name) &&
      baselineComparisons(entry).some(({ comparison }) => comparison.verdict === 'faster'),
  ).length;
  const unchanged = summarized.length - regressedCases.size - faster;
  const summary = [
    `${summarized.length} case${summarized.length === 1 ? '' : 's'} measured`,
    unchanged > 0 ? `${unchanged} unchanged` : null,
    faster > 0 ? `${faster} faster` : null,
    regressedCases.size > 0 ? `${regressedCases.size} slower` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  lines.push(summary, '');

  for (const entry of failed) {
    lines.push(`❌ **${entry.name}**: ${entry.error ?? 'produced no result'}`);
  }
  if (failed.length > 0) {
    lines.push('');
  }

  if (summarized.length > 0) {
    lines.push('<details>', '<summary>Full results</summary>', '');
    lines.push(summarized.map(renderCaseTable).join('\n\n'));
    lines.push(
      '',
      '_Each cell is a 95% confidence interval for the mean; one sample is one page load._',
      '_"unsure" means the interval still straddles zero — the expected result for two equivalent builds._',
      '',
      '</details>',
    );
  }

  if (options.detailsUrl) {
    lines.push('', `[See the full run](${options.detailsUrl})`);
  }

  return lines.join('\n');
}
