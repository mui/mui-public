/* eslint-disable no-console -- a reporter: printing the report is its output. */

// Column widths have to measure visible characters, so chalk's escapes come off first.
import { stripVTControlCharacters as stripAnsi } from 'node:util';
import chalk from 'chalk';
import {
  formatMean,
  formatPercent,
  groupCasesByVariantSet,
  isSummarized,
  refLabel,
  shortNameOf,
} from './format';
import type { SummarizedCase } from './format';
import type { TachometerReport, Verdict } from './ciReport';

/** The report's types, from the schema that defines it. */
export type {
  TachometerReport,
  CaseResult,
  MeasurementResult,
  VariantResult,
  Comparison,
  ReportRef,
  ConfidenceInterval,
  Verdict,
} from './ciReport';

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

function colorVerdict(verdict: Verdict, text: string): string {
  if (verdict === 'faster') {
    return chalk.green(text);
  }
  if (verdict === 'slower') {
    return chalk.red(text);
  }
  return chalk.dim(text);
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
    const sampleCounts = new Set(
      perMeasurement.flatMap(({ found }) => (found ? [found.samples] : [])),
    );

    const cells = perMeasurement.flatMap(({ found, comparison }) => {
      let delta = chalk.dim('—');
      if (variant === reference) {
        delta = chalk.dim('reference');
      } else if (comparison?.versusReference) {
        const { verdict, percentChange } = comparison.versusReference;
        delta = colorVerdict(verdict, `${verdict} ${formatPercent(percentChange)}`);
      }
      return [found ? formatMean(found.meanMs) : chalk.dim('—'), delta];
    });

    return [variant, ...cells, [...sampleCounts].join('/')];
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
          return found ? formatMean(found.meanMs) : chalk.dim('—');
        }),
        ...others.map((variant) => {
          const comparison = byComparison.get(variant);
          if (!comparison) {
            return chalk.dim('—');
          }
          return colorVerdict(
            comparison.verdict,
            `${comparison.verdict} ${formatPercent(comparison.percentChange)}`,
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

  for (const [groupIndex, group] of groupCasesByVariantSet(usable).entries()) {
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

  // No short SHA appended: `id` already ends in one.
  const refLabels = report.refs.map((ref) => `${ref.id} = ${refLabel(ref)}`);
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
