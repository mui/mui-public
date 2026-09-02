import type {
  ConfidenceInterval,
  TachometerCaseResult,
  TachometerMeasurementResult,
  TachometerReport,
} from './types';

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

/** `+2.7% – +6.8%`, both bounds signed so the direction reads without the verdict. */
function formatPercent(interval: ConfidenceInterval): string {
  const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
  return `${signed(interval.low)} – ${signed(interval.high)}`;
}

/** `+6.1 ms – +15.2 ms`. */
function formatMs(interval: ConfidenceInterval): string {
  const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(2)} ms`;
  return `${signed(interval.low)} – ${signed(interval.high)}`;
}

/** `20.50 – 22.67 ms`, with the unit written once. */
function formatMean(interval: ConfidenceInterval): string {
  return `${interval.low.toFixed(2)} – ${interval.high.toFixed(2)} ms`;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

/**
 * Tachometer names each variant `<case> [<variant>]`; the case is already its own heading here.
 */
function shortNameOf(caseName: string, variant: string): string {
  return variant.startsWith(`${caseName} `) ? variant.slice(caseName.length + 1) : variant;
}

type SummarizedCase = TachometerCaseResult & { measurements: TachometerMeasurementResult[] };

function isSummarized(entry: TachometerCaseResult): entry is SummarizedCase {
  return entry.measurements !== undefined && entry.measurements.length > 0;
}

/**
 * Collects the comparisons that mean "this pull request made something slower".
 *
 * `comparisons` express the reference relative to each other variant, so a `slower` verdict means
 * the reference — `[current]` for an auto-expanded case — is the slow side.
 *
 * Only comparisons **across refs** count. A cross-library case runs every variant from the same
 * build, so a `slower` verdict there says this library is slower than a competitor: true, worth
 * knowing, and completely unrelated to what the pull request changed. Flagging those would put a
 * warning on every comment until nobody read it.
 */
export function findRegressions(report: TachometerReport): Regression[] {
  const regressions: Regression[] = [];

  for (const entry of report.cases) {
    if (!isSummarized(entry)) {
      continue;
    }
    for (const measurement of entry.measurements) {
      const referenceRefId = measurement.variants.find(
        (variant) => variant.variant === entry.reference,
      )?.refId;

      for (const comparison of measurement.comparisons) {
        if (comparison.verdict !== 'slower') {
          continue;
        }
        const comparedRefId = measurement.variants.find(
          (variant) => variant.variant === comparison.variant,
        )?.refId;
        if (comparedRefId === referenceRefId) {
          continue;
        }
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
  const rows: string[] = [];

  for (const measurement of entry.measurements) {
    const byVariant = new Map(
      measurement.comparisons.map((comparison) => [comparison.variant, comparison]),
    );
    for (const variant of measurement.variants) {
      const comparison = byVariant.get(variant.variant);
      const isReference = variant.variant === entry.reference;
      const versus = isReference
        ? '_reference_'
        : (comparison && `${comparison.verdict} \`${formatPercent(comparison.percentChange)}\``) ||
          '—';
      rows.push(
        `| ${measurement.name} | ${shortNameOf(entry.name, variant.variant)} | ${formatMean(
          variant.meanMs,
        )} | ${versus} | ${variant.samples} | ${formatBytes(variant.bytesSent)} |`,
      );
    }
  }

  return [
    `**${entry.name}**`,
    '',
    '| Measurement | Variant | Mean (95% CI) | vs reference | Samples | Transferred |',
    '| :--- | :--- | ---: | :--- | ---: | ---: |',
    ...rows,
  ].join('\n');
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
          `(\`${formatMs(regression.absoluteMs)}\`)`,
      );
    }
    lines.push('');
  }

  // Everything that did not regress collapses to a single line, so the regressions are what the eye
  // lands on. `unsure` is the expected result for two equivalent builds, not a warning.
  const faster = summarized.filter((entry) =>
    entry.measurements.some((measurement) =>
      measurement.comparisons.some((comparison) => comparison.verdict === 'faster'),
    ),
  ).length;
  const unchanged = summarized.length - regressions.length - faster;
  const summary = [
    `${summarized.length} case${summarized.length === 1 ? '' : 's'} measured`,
    unchanged > 0 ? `${unchanged} unchanged` : null,
    faster > 0 ? `${faster} faster` : null,
    regressions.length > 0 ? `${regressions.length} slower` : null,
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
