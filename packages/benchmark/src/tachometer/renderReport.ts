/* eslint-disable no-console -- a reporter: printing the report is its output. */

// Column widths have to measure visible characters, so chalk's escapes come off first.
import { stripVTControlCharacters as stripAnsi } from 'node:util';
import chalk from 'chalk';
import type { ConfidenceInterval, Verdict } from './summarizeCase';
import type { CaseResult, MeasurementResult, TachometerReport } from './ciReport';

/**
 * Renders the report `tacho run` produces.
 *
 * Lives beside the runner rather than in the consuming repository because the runner defines the
 * report's shape: keeping the producer and its renderer apart is how a change to one silently
 * breaks the other.
 */

/**
 * The wire format is defined once, by the schema CI validates against and S3 stores. Re-declaring
 * it here is how the exported type and the stored one drift apart — the render side would keep
 * compiling while the report grew a field it never learned about.
 */
export type {
  TachometerReport,
  CaseResult,
  MeasurementResult,
  VariantResult,
  Comparison,
} from './ciReport';

/** A case that produced results, as opposed to one carrying only the error that stopped it. */
type SummarizedCase = CaseResult & { measurements: MeasurementResult[] };

/** Prints a table, padding each column to its widest visible cell. */
function printTable(headers: string[], rows: string[][], leftColumns: number): void {
  const widths = headers.map((header, index) =>
    Math.max(stripAnsi(header).length, ...rows.map((row) => stripAnsi(row[index] ?? '').length)),
  );
  const pad = (text: string, width: number, left: boolean) => {
    const fill = ' '.repeat(Math.max(0, width - stripAnsi(text).length));
    return left ? text + fill : fill + text;
  };
  const line = (cells: string[]) =>
    cells
      .map((cell, index) => pad(cell ?? '', widths[index], index < leftColumns))
      .join('  ')
      .trimEnd();

  console.log(line(headers));
  console.log(widths.map((width) => '─'.repeat(width)).join('  '));
  for (const row of rows) {
    console.log(line(row));
  }
}

/** `low – high`, with the unit written once. */
function formatInterval(interval: ConfidenceInterval): string {
  // Fixed to two places so a column lines up on the decimal point, and written the same way the
  // dashboard writes it, so the terminal and the pull request comment agree digit for digit.
  return `${interval.low.toFixed(2)} – ${interval.high.toFixed(2)} ms`;
}

/** Both bounds as signed percentages. */
function formatPercentInterval(interval: ConfidenceInterval): string {
  const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
  return `${signed(interval.low)} – ${signed(interval.high)}`;
}

function colorVerdict(verdict: Verdict, text: string): string {
  if (verdict === 'faster') {
    return chalk.green(text);
  }
  if (verdict === 'slower') {
    return chalk.red(text);
  }
  return chalk.dim(text);
}

/** Kibibytes, matching how tachometer's own table reports `bytesSent`. */
function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

/**
 * Tachometer names each variant `<case> [<variant>]`, and the case is already its own column, so
 * the prefix is dropped for display. Dropping it is also what makes columns line up across cases:
 * every auto-expanded case then contributes the same `[current]`/`[baseline]` pair rather than a
 * column of its own.
 */
function shortNameOf(caseName: string, variant: string): string {
  return variant.startsWith(`${caseName} `) ? variant.slice(caseName.length + 1) : variant;
}

/** Whether a case produced results, as opposed to carrying only the error that stopped it. */
function isSummarized(entry: CaseResult): entry is SummarizedCase {
  return entry.measurements !== undefined && entry.measurements.length > 0;
}

/** The distinct variants a case reports, in order of first appearance. */
function variantsOf(entry: SummarizedCase): string[] {
  const variants: string[] = [];
  for (const measurement of entry.measurements) {
    for (const variant of measurement.variants) {
      const short = shortNameOf(entry.name, variant.variant);
      if (!variants.includes(short)) {
        variants.push(short);
      }
    }
  }
  return variants;
}

/**
 * Renders one case as a table of variants, for a comparison with more than two of them.
 *
 * Rows are variants, not cases: with several libraries, a column per variant plus a Δ column per
 * pair would run off the screen. Each measurement then shows the variant's interval next to its
 * difference *relative to the reference* — the direction a row about that library reads in — taken
 * from the variant's own row of tachometer's matrix.
 */
function printVariantTable(entry: SummarizedCase, variants: string[]): void {
  const [reference] = variants;
  const headers = [
    entry.name,
    ...entry.measurements.flatMap((measurement) => [measurement.name, `vs ${reference}`]),
    'transferred',
    'Samples',
  ];

  const rows = variants.map((variant) => {
    // Looked up once per row rather than accumulated while the measurement cells render, so the
    // last two columns do not depend on the cell loop having run.
    const perMeasurement = entry.measurements.map((measurement) => ({
      found: measurement.variants.find(
        (candidate) => shortNameOf(entry.name, candidate.variant) === variant,
      ),
      comparison: measurement.comparisons.find(
        (candidate) => shortNameOf(entry.name, candidate.variant) === variant,
      ),
    }));
    // Transfer size is a property of the variant's page, so every measurement reports the same one.
    const bytesSent = perMeasurement.find(({ found }) => found)?.found?.bytesSent;
    const sampleCounts = new Set(
      perMeasurement.flatMap(({ found }) => (found ? [found.samples] : [])),
    );

    const cells = perMeasurement.flatMap(({ found, comparison }) => {
      let delta = chalk.dim('—');
      if (variant === reference) {
        delta = chalk.dim('reference');
      } else if (comparison?.versusReference) {
        const { verdict, percentChange } = comparison.versusReference;
        delta = colorVerdict(verdict, `${verdict} ${formatPercentInterval(percentChange)}`);
      }
      return [found ? formatInterval(found.meanMs) : chalk.dim('—'), delta];
    });

    return [
      variant,
      ...cells,
      bytesSent === undefined ? chalk.dim('—') : formatBytes(bytesSent),
      [...sampleCounts].join('/'),
    ];
  });

  printTable(headers, rows, 1);
  console.log(
    chalk.dim(
      `vs ${reference} is tachometer's confidence interval on the difference, that variant ` +
        `relative to ${reference} — negative is faster than ${reference}.`,
    ),
  );
}

/** Renders a group of cases sharing a variant set, one row per case and measurement. */
function printCaseTable(cases: SummarizedCase[], variants: string[]): void {
  const [reference, ...others] = variants;
  const headers = [
    'Case',
    'Measurement',
    ...variants,
    ...others.map((variant) => `Δ vs ${variant}`),
    'Samples',
  ];

  const rows: string[][] = [];
  for (const [caseIndex, entry] of cases.entries()) {
    if (caseIndex > 0) {
      rows.push(headers.map(() => ''));
    }
    let firstRow = true;
    for (const measurement of entry.measurements) {
      const byVariant = new Map(
        measurement.variants.map((variant) => [shortNameOf(entry.name, variant.variant), variant]),
      );
      const byComparison = new Map(
        measurement.comparisons.map((comparison) => [
          shortNameOf(entry.name, comparison.variant),
          comparison,
        ]),
      );
      // Auto-sampling stops per case, not per variant, so the counts are normally equal; when they
      // are not, saying so beats printing one number that describes neither side.
      const sampleCounts = [...new Set(measurement.variants.map((variant) => variant.samples))];

      rows.push([
        firstRow ? entry.name : '',
        measurement.name,
        ...variants.map((variant) => {
          const found = byVariant.get(variant);
          return found ? formatInterval(found.meanMs) : chalk.dim('—');
        }),
        ...others.map((variant) => {
          const comparison = byComparison.get(variant);
          if (!comparison) {
            return chalk.dim('—');
          }
          return colorVerdict(
            comparison.verdict,
            `${comparison.verdict} ${formatPercentInterval(comparison.percentChange)}`,
          );
        }),
        sampleCounts.join('/'),
      ]);
      firstRow = false;
    }
  }

  printTable(headers, rows, 2);
  console.log(
    chalk.dim(
      `Δ is tachometer's confidence interval on the difference, ${reference ?? 'the reference'} ` +
        `relative to the other variant${others.length > 1 ? 's' : ''} — negative is faster.`,
    ),
  );
}

/**
 * Prints a tachometer report: one table per variant set, with a column per variant holding its 95%
 * confidence interval and a Δ column per non-reference variant.
 *
 * The Δ column is **tachometer's own confidence interval on the difference**, not a delta of the
 * two means. That is the whole reason this suite exists next to a profiling one: variants are
 * sampled round-robin in a single session and auto-sampled until that interval clears the case's
 * `autoSampleConditions`, so the interval — not a point estimate plus a post-hoc test — is the
 * result. `unsure` means it never resolved within the sampling budget, which for two builds that
 * really are equivalent is the expected outcome rather than a failure.
 *
 * Signs are the reference relative to the variant, so a faster reference reads negative; the
 * verdict word carries the direction so the sign never has to be read twice.
 */
export function renderTachometerReport(report: TachometerReport): void {
  // One predicate for both halves: partitioning on two conditions that have to agree left a case
  // with an empty `measurements` array rendered nowhere and reported nowhere.
  const usable = report.cases.filter(isSummarized);
  const failed = report.cases.filter((entry) => !isSummarized(entry));

  if (usable.length === 0) {
    console.log(chalk.dim('No tachometer results to show.'));
    for (const entry of failed) {
      console.log(chalk.red(`  ${entry.name}: ${entry.error ?? 'no result'}`));
    }
    return;
  }

  // One table per variant set, in order of first appearance: a regression case carries
  // `[current]`/`[baseline]`, a cross-library case `[ours]`/`[theirs]`, and each set has its own
  // reference (the first variant). A single table over the union of the columns would put a blank
  // cell in every row of every case, and could name only one reference for all of them.
  const groups = new Map<string, { variants: string[]; cases: SummarizedCase[] }>();
  for (const entry of usable) {
    const variants = variantsOf(entry);
    const key = JSON.stringify(variants);
    const group = groups.get(key) ?? { variants, cases: [] };
    group.cases.push(entry);
    groups.set(key, group);
  }

  for (const [groupIndex, group] of [...groups.values()].entries()) {
    if (groupIndex > 0) {
      console.log('');
    }
    if (group.variants.length > 2) {
      for (const [caseIndex, entry] of group.cases.entries()) {
        if (caseIndex > 0) {
          console.log('');
        }
        printVariantTable(entry, group.variants);
      }
      continue;
    }
    printCaseTable(group.cases, group.variants);
  }

  const notes = [
    'Each cell is a 95% confidence interval for the mean, in milliseconds; one sample = one page load.',
    '"unsure" means the interval still straddles zero: the difference did not resolve within the case\'s sampling budget.',
  ];

  // Bundle weight is a property of the variant's page, not of a measurement, so it belongs in a
  // note rather than repeated down every row. It comes free with the run and is the number that
  // explains a cold-start difference that mount time alone does not. A variant table already gives
  // it a column, so only the cases in the smaller groups need the note.
  for (const entry of [...groups.values()]
    .filter((group) => group.variants.length <= 2)
    .flatMap((group) => group.cases)) {
    const bytes = new Map<string, number>();
    for (const measurement of entry.measurements) {
      for (const variant of measurement.variants) {
        bytes.set(shortNameOf(entry.name, variant.variant), variant.bytesSent);
      }
    }
    const perVariant = [...bytes].map(([variant, value]) => `${variant} ${formatBytes(value)}`);
    if (perVariant.length > 0) {
      notes.push(`${entry.name} transferred: ${perVariant.join('  ·  ')}`);
    }
  }

  // No short SHA appended: `id` is already `git-<short sha>`, and the label is the name the run was
  // given (a committish, or how a symbolic baseline resolved).
  const refLabels = report.refs.map((ref) => `${ref.id} = ${ref.label}`);
  if (refLabels.length > 0) {
    notes.push(`Builds: ${refLabels.join('  ·  ')}`);
  }
  notes.push(
    `head: ${report.head.sha.slice(0, 9)} (${report.head.branch || '?'})  ·  ` +
      `measured on the production bundle, installed from a packed tarball.`,
  );
  console.log(chalk.dim(`\n${notes.join('\n')}`));

  for (const entry of failed) {
    console.log(chalk.red(`\n${entry.name}: ${entry.error ?? 'no result'}`));
  }
}
