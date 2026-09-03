import { describe, expect, it } from 'vitest';
import { buildTachometerMarkdownReport, findRegressions } from './buildMarkdownReport';
import type {
  TachometerCaseResult,
  TachometerMeasurementResult,
  TachometerReport,
  Verdict,
} from './types';

/**
 * A variant on a given build.
 */
function variant(name: string, refId: string | null) {
  return {
    variant: name,
    refId,
    meanMs: { low: 20, high: 22 },
    samples: 120,
    bytesSent: 2969,
  };
}

/** The verdict the other way round; an unresolved difference is unresolved from both sides. */
function mirrorOf(verdict: Verdict): Verdict {
  if (verdict === 'slower') {
    return 'faster';
  }
  return verdict === 'faster' ? 'slower' : verdict;
}

/**
 * A comparison of the reference against `name`, carrying both directions the way a real report
 * does. The two are not negations of each other — each has its own denominator — so the numbers
 * here differ, which is what lets a test tell which direction was rendered.
 */
function comparison(name: string, verdict: Verdict) {
  const sign = verdict === 'slower' ? 1 : -1;
  return {
    variant: name,
    verdict,
    absoluteMs: { low: sign * 6.1, high: sign * 15.2 },
    percentChange: { low: sign * 2.7, high: sign * 6.8 },
    versusReference: {
      verdict: mirrorOf(verdict),
      absoluteMs: { low: sign * -6.1, high: sign * -15.2 },
      percentChange: { low: sign * -2.6, high: sign * -6.4 },
    },
  };
}

/**
 * A case comparing `[current]` against `[baseline]` — two different builds.
 */
function regressionCase(name: string, verdicts: Record<string, Verdict>): TachometerCaseResult {
  const measurements: TachometerMeasurementResult[] = Object.entries(verdicts).map(
    ([measurement, verdict]) => ({
      name: measurement,
      variants: [
        variant(`${name} [current]`, 'current'),
        variant(`${name} [baseline]`, 'git-abc123456'),
      ],
      comparisons: [comparison(`${name} [baseline]`, verdict)],
    }),
  );
  return { name, reference: `${name} [current]`, measurements };
}

/**
 * A case comparing libraries with each other, so every variant comes from the same build.
 */
function libraryCase(name: string, verdict: Verdict): TachometerCaseResult {
  return {
    name,
    reference: `${name} [mosaic]`,
    measurements: [
      {
        name: 'mount',
        variants: [variant(`${name} [mosaic]`, 'current'), variant(`${name} [ag-grid]`, 'current')],
        comparisons: [comparison(`${name} [ag-grid]`, verdict)],
      },
    ],
  };
}

function report(cases: TachometerCaseResult[]): TachometerReport {
  return {
    version: 1,
    reportType: 'tachometer',
    generatedAt: '2026-09-02T00:00:00.000Z',
    head: { ref: 'HEAD', sha: 'a'.repeat(40), branch: 'feature' },
    refs: [
      { id: 'current', kind: 'worktree', label: 'working tree' },
      { id: 'git-abc123456', kind: 'git', label: 'merge-base', sha: 'b'.repeat(40) },
    ],
    cases,
  };
}

/** Everything a reader sees without expanding anything. */
function visiblePart(markdown: string): string {
  return markdown.split('<details>')[0];
}

/** The collapsed table's row for `variant`, rather than any prose that names it too. */
function tableRowFor(markdown: string, variantName: string): string | undefined {
  return markdown
    .split('<details>')[1]
    ?.split('\n')
    .find((line) => line.startsWith('|') && line.includes(variantName));
}

describe('findRegressions', () => {
  it('finds a slower verdict across two builds', () => {
    const found = findRegressions(report([regressionCase('workload', { mount: 'slower' })]));

    expect(found).toMatchObject([{ caseName: 'workload', measurement: 'mount' }]);
  });

  it.each<Verdict>(['unsure', 'faster'])('does not count a %s verdict', (verdict) => {
    expect(findRegressions(report([regressionCase('workload', { mount: verdict })]))).toEqual([]);
  });

  it('ignores a slower verdict between variants on the same build', () => {
    // A cross-library case runs every variant from one build, so "slower than ag-grid" says nothing
    // about what this pull request changed. Flagging it would warn on every comment forever.
    expect(findRegressions(report([libraryCase('libs-mount', 'slower')]))).toEqual([]);
  });

  it('reports only the measurement that regressed', () => {
    const found = findRegressions(
      report([regressionCase('workload', { mount: 'slower', scroll: 'unsure' })]),
    );

    expect(found).toHaveLength(1);
    expect(found[0].measurement).toBe('mount');
  });
});

describe('buildTachometerMarkdownReport', () => {
  it('states a regression before the collapsed block, where it can be seen', () => {
    // GitHub renders <details> closed, so a regression inside it is invisible.
    const markdown = buildTachometerMarkdownReport(
      report([regressionCase('workload', { mount: 'slower' })]),
    );

    expect(visiblePart(markdown)).toContain('workload');
    expect(visiblePart(markdown)).toContain('mount');
    expect(visiblePart(markdown)).toContain('+2.7% – +6.8%');
  });

  it('marks the heading when something regressed', () => {
    const markdown = buildTachometerMarkdownReport(
      report([regressionCase('workload', { mount: 'slower' })]),
    );

    expect(markdown.split('\n')[0]).toBe('## Tachometer ⚠️');
  });

  it('leaves the heading unmarked when nothing regressed', () => {
    const markdown = buildTachometerMarkdownReport(
      report([regressionCase('workload', { mount: 'unsure' })]),
    );

    expect(markdown.split('\n')[0]).toBe('## Tachometer');
    expect(visiblePart(markdown)).not.toContain('⚠️');
  });

  it('summarizes a clean run in one line', () => {
    const markdown = buildTachometerMarkdownReport(
      report([
        regressionCase('workload', { mount: 'unsure' }),
        regressionCase('scroll', { mount: 'unsure' }),
      ]),
    );

    expect(visiblePart(markdown)).toContain('2 cases measured · 2 unchanged');
  });

  it('counts a case that regressed in two measurements once', () => {
    // The total beside it counts cases, so counting measurements here stopped the line adding up.
    const markdown = buildTachometerMarkdownReport(
      report([regressionCase('workload', { mount: 'slower', 'cold-start': 'slower' })]),
    );

    expect(visiblePart(markdown)).toContain('1 case measured · 1 slower');
  });

  it('does not count beating another library as having got faster', () => {
    const markdown = buildTachometerMarkdownReport(
      report([
        libraryCase('libs-mount', 'faster'),
        regressionCase('workload', { mount: 'unsure' }),
      ]),
    );

    expect(visiblePart(markdown)).toContain('2 cases measured · 2 unchanged');
    expect(visiblePart(markdown)).not.toContain('faster');
  });

  it('counts a faster case separately', () => {
    const markdown = buildTachometerMarkdownReport(
      report([
        regressionCase('workload', { mount: 'faster' }),
        regressionCase('scroll', { mount: 'unsure' }),
      ]),
    );

    expect(visiblePart(markdown)).toContain('1 faster');
  });

  it('reports a case that produced no result', () => {
    const markdown = buildTachometerMarkdownReport(
      report([{ name: 'broken', error: 'produced no benchmarks' }]),
    );

    expect(visiblePart(markdown)).toContain('broken');
    expect(visiblePart(markdown)).toContain('produced no benchmarks');
  });

  it('puts every variant and measurement in the collapsed table', () => {
    const markdown = buildTachometerMarkdownReport(
      report([regressionCase('workload', { mount: 'unsure', scroll: 'unsure' })]),
    );

    const details = markdown.split('<details>')[1];
    expect(details).toContain('mount');
    expect(details).toContain('scroll');
    expect(details).toContain('[current]');
    expect(details).toContain('[baseline]');
  });

  it('states each row as the variant against the reference, not the reference against it', () => {
    // The row sits under a "vs reference" heading next to the variant's own mean, so it has to
    // read as a statement about that variant. Rendering the direction a regression is stated in
    // makes a variant that is slower than the reference look faster than it.
    const markdown = buildTachometerMarkdownReport(
      report([regressionCase('workload', { mount: 'slower' })]),
    );

    expect(tableRowFor(markdown, '[baseline]')).toContain('faster `-2.6% – -6.4%`');
  });

  it('leaves the comparison out when the report has only one direction', () => {
    // Older reports, written before both directions were captured.
    const oneDirection = report([regressionCase('workload', { mount: 'slower' })]);
    delete oneDirection.cases[0].measurements![0].comparisons[0].versusReference;

    const markdown = buildTachometerMarkdownReport(oneDirection);

    expect(tableRowFor(markdown, '[baseline]')).toContain('—');
  });

  it('links to the full run when given a url', () => {
    const markdown = buildTachometerMarkdownReport(
      report([regressionCase('workload', { mount: 'unsure' })]),
      { detailsUrl: 'https://example.test/run' },
    );

    expect(markdown).toContain('[See the full run](https://example.test/run)');
  });
});
