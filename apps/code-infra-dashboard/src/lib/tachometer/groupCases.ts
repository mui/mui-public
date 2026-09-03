import type { TachometerCaseResult, TachometerMeasurementResult } from './types';

export type SummarizedCase = TachometerCaseResult & {
  measurements: TachometerMeasurementResult[];
};

export interface VariantGroup {
  /** The variant set the group's cases share, reference first. */
  variants: string[];
  cases: SummarizedCase[];
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

/** A case that produced results, as opposed to one whose run failed and carries only an error. */
export function isSummarized(entry: TachometerCaseResult): entry is SummarizedCase {
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
 * Splits cases into the groups that each get their own table, the way the terminal report does.
 *
 * A regression case carries `[current]`/`[baseline]`, a cross-library case `[ours]`/`[theirs]`, and
 * each set has its own reference — the first variant. One table over the union of the columns would
 * leave a blank cell in every row of every case, and could name only one reference for all of them.
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

/** What each of a case's variants transferred, for the cases whose table has no such column. */
export function bytesPerVariant(entry: SummarizedCase): Array<[string, number]> {
  const bytes = new Map<string, number>();

  for (const measurement of entry.measurements) {
    for (const variant of measurement.variants) {
      bytes.set(shortNameOf(entry.name, variant.variant), variant.bytesSent);
    }
  }

  return [...bytes];
}
