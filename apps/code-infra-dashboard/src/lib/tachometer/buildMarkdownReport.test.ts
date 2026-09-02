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

/**
 * A comparison of the reference against `name`.
 */
function comparison(name: string, verdict: Verdict) {
  const sign = verdict === 'slower' ? 1 : -1;
  return {
    variant: name,
    verdict,
    absoluteMs: { low: sign * 6.1, high: sign * 15.2 },
    percentChange: { low: sign * 2.7, high: sign * 6.8 },
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
    const libs: TachometerCaseResult = {
      name: 'libs-mount',
      reference: 'libs-mount [mosaic]',
      measurements: [
        {
          name: 'mount',
          variants: [
            variant('libs-mount [mosaic]', 'current'),
            variant('libs-mount [ag-grid]', 'current'),
          ],
          comparisons: [comparison('libs-mount [ag-grid]', 'slower')],
        },
      ],
    };

    expect(findRegressions(report([libs]))).toEqual([]);
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

  it('links to the full run when given a url', () => {
    const markdown = buildTachometerMarkdownReport(
      report([regressionCase('workload', { mount: 'unsure' })]),
      { detailsUrl: 'https://example.test/run' },
    );

    expect(markdown).toContain('[See the full run](https://example.test/run)');
  });
});
