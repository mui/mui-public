import { describe, expect, it } from 'vitest';
import { tachometerUploadSchema } from './ciReport.mjs';

/**
 * A report of the shape `runTachometer` writes, trimmed to one case.
 *
 * @param {Partial<any>} [overrides] - Fields to replace
 * @returns {any}
 */
function report(overrides = {}) {
  return {
    version: 1,
    reportType: 'tachometer',
    generatedAt: '2026-09-02T00:00:00.000Z',
    head: { ref: 'HEAD', sha: 'a'.repeat(40), branch: 'feature' },
    browser: '/path/to/Chrome for Testing',
    refs: [
      { id: 'current', kind: 'worktree', label: 'working tree' },
      { id: 'git-abc123456', kind: 'git', label: 'merge-base', sha: 'b'.repeat(40) },
    ],
    cases: [
      {
        name: 'workload',
        reference: 'workload [current]',
        measurements: [
          {
            name: 'mount',
            variants: [
              {
                variant: 'workload [current]',
                refId: 'current',
                meanMs: { low: 20.5, high: 22.7 },
                samples: 120,
                bytesSent: 2969,
              },
            ],
            comparisons: [
              {
                variant: 'workload [baseline]',
                verdict: 'unsure',
                absoluteMs: { low: -1.2, high: 2.1 },
                percentChange: { low: -5.2, high: 9.3 },
                versusReference: {
                  verdict: 'unsure',
                  absoluteMs: { low: -2.1, high: 1.2 },
                  percentChange: { low: -9.3, high: 5.2 },
                },
              },
            ],
          },
        ],
      },
    ],
    raw: { workload: { benchmarks: [] } },
    ...overrides,
  };
}

/**
 * @param {Partial<any>} [overrides] - Envelope fields to replace
 * @returns {any}
 */
function envelope(overrides = {}) {
  return {
    version: 1,
    timestamp: 1_770_000_000_000,
    commitSha: 'a'.repeat(40),
    repo: 'mui/mui-public',
    reportType: 'tachometer',
    prNumber: 1829,
    branch: 'feature',
    report: report(),
    ...overrides,
  };
}

describe('tachometerUploadSchema', () => {
  it('accepts a report of the shape the runner writes', () => {
    expect(tachometerUploadSchema.safeParse(envelope()).success).toBe(true);
  });

  it('carries the envelope metadata through', () => {
    const parsed = tachometerUploadSchema.parse(envelope());

    expect(parsed).toMatchObject({
      repo: 'mui/mui-public',
      prNumber: 1829,
      branch: 'feature',
      reportType: 'tachometer',
    });
  });

  it('accepts a run with no pull request', () => {
    // A push to the base branch uploads too; it just has no PR to comment on.
    const { prNumber, ...withoutPr } = envelope();

    expect(tachometerUploadSchema.safeParse(withoutPr).success).toBe(true);
  });

  it('accepts a case that failed to summarize', () => {
    // Kept in the report rather than dropped, so the comment can say the case produced nothing.
    const withFailure = envelope({
      report: report({ cases: [{ name: 'broken', error: 'produced no benchmarks' }] }),
    });

    expect(tachometerUploadSchema.safeParse(withFailure).success).toBe(true);
  });

  describe('rejects', () => {
    it('a report from another benchmark axis', () => {
      // The dashboard routes on reportType, so the wrong one would render as the wrong thing.
      const wrongType = envelope({ reportType: 'benchmark' });

      expect(tachometerUploadSchema.safeParse(wrongType).success).toBe(false);
    });

    it('a commit that is not a full sha', () => {
      // The artifact key is built from it, and a short sha would not match what the dashboard
      // looks up for the head commit.
      expect(tachometerUploadSchema.safeParse(envelope({ commitSha: 'abc1234' })).success).toBe(
        false,
      );
    });

    it('a repo that is not owner/name', () => {
      expect(tachometerUploadSchema.safeParse(envelope({ repo: 'mui-public' })).success).toBe(
        false,
      );
    });

    it('a verdict outside the known set', () => {
      const badVerdict = report();
      badVerdict.cases[0].measurements[0].comparisons[0].verdict = 'regressed';

      expect(tachometerUploadSchema.safeParse(envelope({ report: badVerdict })).success).toBe(
        false,
      );
    });
  });
});
