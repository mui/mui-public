import type { Root } from 'hast';
import type { Category } from './categories';
import { COMPARABLE_CATEGORIES } from './categories';
import type { Engine } from './engine';
import { categorizeChars } from './hast';
import type { Language } from './languages';

export interface CategoryCounts {
  both: number;
  baselineOnly: number;
  engineOnly: number;
}

export type FidelityCounts = Partial<Record<Category, CategoryCounts>>;

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r';
}

/** Counts, per comparable category, the non-whitespace characters both engines (or only one) assign to it. */
export function compareCategories(
  source: string,
  language: Language,
  baseline: { engine: Engine; root: Root },
  candidate: { engine: Engine; root: Root },
  into: FidelityCounts = {},
): FidelityCounts {
  const expected = categorizeChars(baseline.root, baseline.engine.categorize, language);
  const actual = categorizeChars(candidate.root, candidate.engine.categorize, language);
  for (let index = 0; index < source.length; index += 1) {
    if (isWhitespace(source[index])) {
      continue;
    }
    const left = expected[index];
    const right = actual[index];
    for (const category of COMPARABLE_CATEGORIES) {
      if (left !== category && right !== category) {
        continue;
      }
      const counts = into[category] ?? { both: 0, baselineOnly: 0, engineOnly: 0 };
      into[category] = counts;
      if (left === right) {
        counts.both += 1;
      } else if (left === category) {
        counts.baselineOnly += 1;
      } else {
        counts.engineOnly += 1;
      }
    }
  }
  return into;
}

/** Intersection over union; `undefined` when neither engine uses the category. */
export function jaccard(counts: CategoryCounts | undefined): number | undefined {
  if (!counts) {
    return undefined;
  }
  const union = counts.both + counts.baselineOnly + counts.engineOnly;
  return union === 0 ? undefined : counts.both / union;
}

export function sumCounts(counts: FidelityCounts): CategoryCounts {
  return Object.values(counts).reduce(
    (total, entry) => ({
      both: total.both + entry.both,
      baselineOnly: total.baselineOnly + entry.baselineOnly,
      engineOnly: total.engineOnly + entry.engineOnly,
    }),
    { both: 0, baselineOnly: 0, engineOnly: 0 },
  );
}
