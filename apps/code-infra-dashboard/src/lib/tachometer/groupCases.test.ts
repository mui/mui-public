import { describe, expect, it } from 'vitest';
import { bytesPerVariant, groupCasesByVariantSet, shortNameOf, variantsOf } from './groupCases';
import type { SummarizedCase } from './groupCases';

function variant(name: string, bytesSent = 2969) {
  return {
    variant: name,
    refId: 'current',
    meanMs: { low: 20, high: 22 },
    samples: 120,
    bytesSent,
  };
}

function caseWith(name: string, variantNames: string[], measurements = ['mount']): SummarizedCase {
  return {
    name,
    reference: `${name} ${variantNames[0]}`,
    measurements: measurements.map((measurement) => ({
      name: measurement,
      variants: variantNames.map((short) => variant(`${name} ${short}`)),
      comparisons: [],
    })),
  };
}

describe('shortNameOf', () => {
  it('drops the case prefix tachometer puts on a variant', () => {
    expect(shortNameOf('libs-mount', 'libs-mount [ag-grid]')).toBe('[ag-grid]');
  });

  it('leaves a name that does not carry the prefix alone', () => {
    expect(shortNameOf('scroll', 'row-updates [current]')).toBe('row-updates [current]');
  });
});

describe('variantsOf', () => {
  it('lists the variants in the order they first appear', () => {
    expect(variantsOf(caseWith('libs-mount', ['[mosaic]', '[ag-grid]', '[mui-x]']))).toEqual([
      '[mosaic]',
      '[ag-grid]',
      '[mui-x]',
    ]);
  });

  it('counts a variant once across measurements', () => {
    const entry = caseWith('workload', ['[current]', '[baseline]'], ['mount', 'cold-start']);

    expect(variantsOf(entry)).toEqual(['[current]', '[baseline]']);
  });
});

describe('groupCasesByVariantSet', () => {
  it('puts cases sharing a variant set in one group', () => {
    // Auto-expanded cases all carry [current]/[baseline], so they belong in one table.
    const groups = groupCasesByVariantSet([
      caseWith('workload', ['[current]', '[baseline]']),
      caseWith('scroll', ['[current]', '[baseline]']),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].cases.map((entry) => entry.name)).toEqual(['workload', 'scroll']);
  });

  it('gives a case with a different variant set its own group', () => {
    // A table over the union would leave a blank cell in every row, and could name only one
    // reference for both.
    const groups = groupCasesByVariantSet([
      caseWith('workload', ['[current]', '[baseline]']),
      caseWith('libs-mount', ['[mosaic]', '[ag-grid]']),
    ]);

    expect(groups.map((group) => group.variants)).toEqual([
      ['[current]', '[baseline]'],
      ['[mosaic]', '[ag-grid]'],
    ]);
  });

  it('separates variant sets that differ only in order', () => {
    // The first variant is the reference, so the same names in another order is another table.
    const groups = groupCasesByVariantSet([
      caseWith('a', ['[current]', '[baseline]']),
      caseWith('b', ['[baseline]', '[current]']),
    ]);

    expect(groups).toHaveLength(2);
  });

  it('keeps the groups in order of first appearance', () => {
    const groups = groupCasesByVariantSet([
      caseWith('libs-mount', ['[mosaic]', '[ag-grid]']),
      caseWith('workload', ['[current]', '[baseline]']),
      caseWith('libs-scroll', ['[mosaic]', '[ag-grid]']),
    ]);

    expect(groups.map((group) => group.cases.map((entry) => entry.name))).toEqual([
      ['libs-mount', 'libs-scroll'],
      ['workload'],
    ]);
  });
});

describe('bytesPerVariant', () => {
  it('reports one figure per variant, not per measurement', () => {
    const entry = caseWith('workload', ['[current]', '[baseline]'], ['mount', 'cold-start']);

    expect(bytesPerVariant(entry)).toEqual([
      ['[current]', 2969],
      ['[baseline]', 2969],
    ]);
  });
});
