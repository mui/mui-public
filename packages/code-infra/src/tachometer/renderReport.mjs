/* eslint-disable no-console -- a reporter: printing the report is its output. */

import chalk from 'chalk';

/**
 * Renders the report `tacho run` produces.
 *
 * Lives beside the runner rather than in the consuming repository because the runner defines the
 * report's shape: keeping the producer and its renderer apart is how a change to one silently
 * breaks the other.
 */

/**
 * @typedef {import('./summarizeCase.mjs').ConfidenceInterval} ConfidenceInterval
 * @typedef {import('./summarizeCase.mjs').Verdict} Verdict
 */

/**
 * @typedef {Object} VariantResult
 * @property {string} variant - Variant name
 * @property {string | null} refId - The ref this variant loaded
 * @property {ConfidenceInterval} meanMs - Mean duration, as a 95% confidence interval
 * @property {number} samples - Sample count
 * @property {number} bytesSent - Bytes transferred
 */

/**
 * @typedef {Object} Comparison
 * @property {string} variant - The variant compared against the reference
 * @property {Verdict} verdict - Whether the reference is faster, slower, or unresolved
 * @property {ConfidenceInterval} absoluteMs - Difference in milliseconds
 * @property {ConfidenceInterval} percentChange - Difference as a percentage
 * @property {{ verdict: Verdict, absoluteMs: ConfidenceInterval, percentChange: ConfidenceInterval }} [versusReference] - The same pair the other way round
 */

/**
 * @typedef {Object} MeasurementResult
 * @property {string} name - Measurement name
 * @property {VariantResult[]} variants - One entry per variant
 * @property {Comparison[]} comparisons - The reference against every other variant
 */

/**
 * @typedef {Object} CaseResult
 * @property {string} name - Case name
 * @property {string} [reference] - The variant every comparison is expressed against. Absent when the case failed to summarize
 * @property {MeasurementResult[]} [measurements] - One entry per measurement
 * @property {string} [error] - Why the case produced no summary
 */

/**
 * @typedef {Object} TachometerReport
 * @property {number} version - Report format version
 * @property {'tachometer'} reportType - Which benchmark axis produced this
 * @property {string} generatedAt - ISO timestamp
 * @property {{ ref: string, sha: string, branch?: string }} head - The commit measured
 * @property {Array<{ id: string, kind: string, label: string, sha?: string }>} refs - The builds compared
 * @property {CaseResult[]} cases - One entry per case
 */

/** Milliseconds, to the precision tachometer's own table uses. */
const MS_FORMAT = /** @type {Intl.NumberFormatOptions} */ ({
  style: 'unit',
  unit: 'millisecond',
  maximumFractionDigits: 2,
  // Pad to the declared precision so a column lines up on the decimal point (`29.0 ms` under
  // `30.9 ms`, not `29 ms`).
  minimumFractionDigits: 2,
});

const msFormatter = new Intl.NumberFormat('en-US', MS_FORMAT);

/**
 * Matches the escape sequences chalk emits, so column widths measure visible characters.
 *
 * Built from a char code rather than written as a literal: an escape character inside a regular
 * expression source is invisible in a diff and trips `no-control-regex`.
 */
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/**
 * @param {string} text - Possibly coloured text
 * @returns {string} The same text with colour escapes removed
 */
function stripAnsi(text) {
  return text.replace(ANSI, '');
}

/**
 * Prints a table, padding each column to its widest visible cell.
 *
 * @param {string[]} headers - Column headers
 * @param {string[][]} rows - Row cells, in column order
 * @param {boolean[]} alignLeft - Whether each column is left-aligned
 * @returns {void}
 */
function printTable(headers, rows, alignLeft) {
  const widths = headers.map((header, index) =>
    Math.max(stripAnsi(header).length, ...rows.map((row) => stripAnsi(row[index] ?? '').length)),
  );
  /**
   * @param {string} text - Cell contents
   * @param {number} width - Target width
   * @param {boolean} left - Whether to left-align
   * @returns {string}
   */
  const pad = (text, width, left) => {
    const fill = ' '.repeat(Math.max(0, width - stripAnsi(text).length));
    return left ? text + fill : fill + text;
  };
  /**
   * @param {string[]} cells - One row
   * @returns {string}
   */
  const line = (cells) =>
    cells
      .map((cell, index) => pad(cell ?? '', widths[index], alignLeft[index]))
      .join('  ')
      .trimEnd();

  console.log(line(headers));
  console.log(widths.map((width) => '─'.repeat(width)).join('  '));
  for (const row of rows) {
    console.log(line(row));
  }
}

/**
 * `low – high`, with the unit written once.
 *
 * @param {ConfidenceInterval} interval - The interval to format
 * @returns {string}
 */
function formatInterval(interval) {
  return `${msFormatter.format(interval.low).replace(/\s*ms$/, '')} – ${msFormatter.format(interval.high)}`;
}

/**
 * @param {ConfidenceInterval} interval - The interval to format
 * @returns {string} Both bounds as signed percentages
 */
function formatPercentInterval(interval) {
  /**
   * @param {number} value - A percentage
   * @returns {string}
   */
  const signed = (value) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
  return `${signed(interval.low)} – ${signed(interval.high)}`;
}

/**
 * @param {Verdict} verdict - The verdict to colour by
 * @param {string} text - Text to colour
 * @returns {string}
 */
function colorVerdict(verdict, text) {
  if (verdict === 'faster') {
    return chalk.green(text);
  }
  if (verdict === 'slower') {
    return chalk.red(text);
  }
  return chalk.dim(text);
}

/**
 * Kibibytes, matching how tachometer's own table reports `bytesSent`.
 *
 * @param {number} bytes - Byte count
 * @returns {string}
 */
function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

/**
 * Tachometer names each variant `<case> [<variant>]`, and the case is already its own column, so
 * the prefix is dropped for display. Dropping it is also what makes columns line up across cases:
 * every auto-expanded case then contributes the same `[current]`/`[baseline]` pair rather than a
 * column of its own.
 *
 * @param {string} caseName - The case's name
 * @param {string} variant - The variant's full name
 * @returns {string}
 */
function shortNameOf(caseName, variant) {
  return variant.startsWith(`${caseName} `) ? variant.slice(caseName.length + 1) : variant;
}

/**
 * The distinct variants a case reports, in order of first appearance.
 *
 * @param {CaseResult & { measurements: MeasurementResult[] }} entry - A summarized case
 * @returns {string[]}
 */
function variantsOf(entry) {
  /** @type {string[]} */
  const variants = [];
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
 *
 * @param {CaseResult & { measurements: MeasurementResult[] }} entry - A summarized case
 * @param {string[]} variants - The variant set, reference first
 * @returns {void}
 */
function printVariantTable(entry, variants) {
  const [reference] = variants;
  const headers = [
    entry.name,
    ...entry.measurements.flatMap((measurement) => [measurement.name, `vs ${reference}`]),
    'transferred',
    'Samples',
  ];
  const alignLeft = headers.map((_, index) => index === 0);

  const rows = variants.map((variant) => {
    /** @type {number | undefined} */
    let bytesSent;
    /** @type {Set<number>} */
    const sampleCounts = new Set();
    const cells = entry.measurements.flatMap((measurement) => {
      const found = measurement.variants.find(
        (candidate) => shortNameOf(entry.name, candidate.variant) === variant,
      );
      const comparison = measurement.comparisons.find(
        (candidate) => shortNameOf(entry.name, candidate.variant) === variant,
      );
      if (found) {
        bytesSent = found.bytesSent;
        sampleCounts.add(found.samples);
      }
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

  printTable(headers, rows, alignLeft);
  console.log(
    chalk.dim(
      `vs ${reference} is tachometer's confidence interval on the difference, that variant ` +
        `relative to ${reference} — negative is faster than ${reference}.`,
    ),
  );
}

/**
 * Renders a group of cases sharing a variant set, one row per case and measurement.
 *
 * @param {Array<CaseResult & { measurements: MeasurementResult[] }>} cases - Cases in the group
 * @param {string[]} variants - The shared variant set, reference first
 * @returns {void}
 */
function printCaseTable(cases, variants) {
  const [reference, ...others] = variants;
  const headers = [
    'Case',
    'Measurement',
    ...variants,
    ...others.map((variant) => `Δ vs ${variant}`),
    'Samples',
  ];
  const alignLeft = [true, true, ...variants.map(() => false), ...others.map(() => false), false];

  /** @type {string[][]} */
  const rows = [];
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

  printTable(headers, rows, alignLeft);
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
 *
 * @param {TachometerReport} report - The report to render
 * @returns {void}
 */
export function renderTachometerReport(report) {
  const failed = report.cases.filter((entry) => !entry.measurements);
  const usable = /** @type {Array<CaseResult & { measurements: MeasurementResult[] }>} */ (
    report.cases.filter(
      (entry) => entry.measurements !== undefined && entry.measurements.length > 0,
    )
  );

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
  /** @type {Map<string, { variants: string[], cases: Array<CaseResult & { measurements: MeasurementResult[] }> }>} */
  const groups = new Map();
  for (const entry of usable) {
    const variants = variantsOf(entry);
    const key = JSON.stringify(variants);
    const group = groups.get(key) ?? { variants, cases: [] };
    group.cases.push(entry);
    groups.set(key, group);
  }

  // Only a variant table carries the transfer size as a column, so only the other cases need the
  // note below. Derived from the grouping rather than collected while printing, so the notes do not
  // depend on the tables having been rendered first.
  const withBytesColumn = new Set(
    [...groups.values()]
      .filter((group) => group.variants.length > 2)
      .flatMap((group) => group.cases.map((entry) => entry.name)),
  );

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
  // explains a cold-start difference that mount time alone does not.
  for (const entry of usable) {
    if (withBytesColumn.has(entry.name)) {
      continue;
    }
    /** @type {Map<string, number>} */
    const bytes = new Map();
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

  const refLabels = report.refs.map(
    (ref) => `${ref.id} = ${ref.label}${ref.sha ? ` (${ref.sha.slice(0, 9)})` : ''}`,
  );
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
