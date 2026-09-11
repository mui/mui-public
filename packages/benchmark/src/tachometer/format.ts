import type { CaseResult, MeasurementResult, ReportRef, ConfidenceInterval } from './ciReport';

/**
 * How a report's numbers and names are written, for every renderer of one.
 *
 * The terminal table and the pull request comment show the same run, so they format it here rather
 * than each their own way. Pure, and free of anything node-only, so a browser can import it.
 */

/** A case that produced results, as opposed to one carrying only the error that stopped it. */
export type SummarizedCase = CaseResult & { measurements: MeasurementResult[] };

export interface VariantGroup {
  /** The variant set the group's cases share, reference first. */
  variants: string[];
  cases: SummarizedCase[];
}

/** `20.50 – 22.67 ms`, with the unit written once. */
export function formatMean(interval: ConfidenceInterval): string {
  return `${interval.low.toFixed(2)} – ${interval.high.toFixed(2)} ms`;
}

/** Both bounds signed, so the direction of a difference reads without the verdict beside it. */
function signedInterval(interval: ConfidenceInterval, unit: string, digits: number): string {
  const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(digits)}${unit}`;
  return `${signed(interval.low)} – ${signed(interval.high)}`;
}

/** `+2.7% – +6.8%`. */
export function formatPercent(interval: ConfidenceInterval): string {
  return signedInterval(interval, '%', 1);
}

/** `+6.10 ms – +15.20 ms`. */
export function formatSignedMs(interval: ConfidenceInterval): string {
  return signedInterval(interval, ' ms', 2);
}

/** What a ref is called in a report: the working tree, or the revision the run was given. */
export function refLabel(ref: ReportRef): string {
  return ref.kind === 'worktree' ? 'working tree' : ref.requested;
}

/**
 * Tachometer names each variant `<case> [<variant>]`, and the case is named by the table itself, so
 * the prefix is dropped for display. Dropping it is also what lets cases share a table: every
 * auto-expanded case then contributes the same `[current]`/`[baseline]` pair rather than a pair of
 * its own.
 */
export function shortNameOf(caseName: string, variant: string): string {
  return variant.startsWith(`${caseName} `) ? variant.slice(caseName.length + 1) : variant;
}

/** Whether a case produced results, as opposed to carrying only the error that stopped it. */
export function isSummarized(entry: CaseResult): entry is SummarizedCase {
  return entry.measurements !== undefined && entry.measurements.length > 0;
}

/** The distinct variants a case reports, in order of first appearance. */
export function variantsOf(entry: SummarizedCase): string[] {
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
 * Splits cases into the groups that each get their own table.
 *
 * A regression case carries `[current]`/`[baseline]`, a cross-library case `[ours]`/`[theirs]`, and
 * each set has its own reference, the first variant. One table over the union of the columns would
 * leave a blank cell in every row, and could name only one reference for all of them.
 */
export function groupCasesByVariantSet(cases: SummarizedCase[]): VariantGroup[] {
  const groups = new Map<string, VariantGroup>();

  for (const entry of cases) {
    const variants = variantsOf(entry);
    const key = JSON.stringify(variants);
    const group = groups.get(key) ?? { variants, cases: [] };
    group.cases.push(entry);
    groups.set(key, group);
  }

  return [...groups.values()];
}
