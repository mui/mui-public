import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseReportState, selectTrustedComments } from './reportState.mjs';

const actionDir = import.meta.dirname;

const withTempDir = (callback) => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'renovate-pr-report-'));
  try {
    return callback(workDir);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
};

const createPullRequest = (overrides = {}) => ({
  number: 1,
  title: 'Bump example',
  body: '| Package | Change |\n| --- | --- |\n| example | `1.0.0` → `1.1.0` |',
  url: 'https://github.com/example/repository/pull/1',
  createdAt: new Date().toISOString(),
  isDraft: false,
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  reviewDecision: 'APPROVED',
  author: { login: 'code-infra-renovate' },
  labels: { nodes: [] },
  commits: {
    nodes: [{ commit: { oid: 'abc123', statusCheckRollup: { state: 'SUCCESS' } } }],
  },
  ...overrides,
});

const runTriage = (pullRequests) =>
  withTempDir((workDir) => {
    fs.writeFileSync(
      path.join(workDir, 'prs.json'),
      JSON.stringify([{ data: { repository: { pullRequests: { nodes: pullRequests } } } }]),
    );
    fs.writeFileSync(path.join(workDir, 'cache.json'), '{}');
    fs.writeFileSync(path.join(workDir, 'output'), '');
    execFileSync(process.execPath, [path.join(actionDir, 'triagePullRequests.mjs')], {
      env: {
        ...process.env,
        WORK_DIR: workDir,
        MAX_AGE_DAYS: '10',
        BOT_LOGIN: 'code-infra-renovate[bot]',
        GITHUB_OUTPUT: path.join(workDir, 'output'),
      },
    });
    return {
      triaged: JSON.parse(fs.readFileSync(path.join(workDir, 'triaged.json'), 'utf8')),
      candidates: JSON.parse(fs.readFileSync(path.join(workDir, 'candidates.json'), 'utf8')),
    };
  });

const runReport = ({ triaged, verdicts }) =>
  withTempDir((workDir) => {
    fs.writeFileSync(path.join(workDir, 'triaged.json'), JSON.stringify(triaged));
    fs.writeFileSync(path.join(workDir, 'cache.json'), '{}');
    fs.writeFileSync(path.join(workDir, 'announced.json'), '[]');
    fs.writeFileSync(path.join(workDir, 'output'), '');
    if (verdicts) {
      fs.writeFileSync(path.join(workDir, 'verdicts.json'), JSON.stringify(verdicts));
    }
    execFileSync(process.execPath, [path.join(actionDir, 'renderReport.mjs')], {
      env: {
        ...process.env,
        WORK_DIR: workDir,
        MAX_AGE_DAYS: '10',
        BOT_LOGIN: 'code-infra-renovate[bot]',
        STICKY_MARKER: '<!-- renovate-pr-report:sticky -->',
        ANNOUNCE_MARKER: '<!-- renovate-pr-report:announce -->',
        MENTION: '@example/team',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'example/repository',
        GITHUB_RUN_ID: '1',
        GITHUB_WORKFLOW: 'Renovate PR report',
        GITHUB_OUTPUT: path.join(workDir, 'output'),
      },
    });
    return fs.readFileSync(path.join(workDir, 'report.md'), 'utf8');
  });

describe('Renovate PR triage', () => {
  it('normalizes GraphQL bot logins and finds the highest grouped bump', () => {
    const pullRequest = createPullRequest({
      body: [
        '| Package | Change |',
        '| --- | --- |',
        '| first | `1.0.0` → `1.0.1` |',
        '| second | `2.1.0` → `2.2.0` |',
      ].join('\n'),
      mergeStateStatus: 'BEHIND',
    });

    const result = runTriage([pullRequest]);

    expect(result.triaged[0]).toMatchObject({
      bump: 'minor',
      blockers: ['base branch update'],
      analysisCandidate: true,
    });
    expect(result.candidates).toHaveLength(1);
  });

  it('does not analyze a Unicode-arrow patch without a risk heuristic', () => {
    const result = runTriage([createPullRequest({ body: '| example | `1.0.0` → `1.0.1` |' })]);

    expect(result.triaged[0].bump).toBe('patch');
    expect(result.candidates).toEqual([]);
  });
});

describe('Renovate PR report state', () => {
  it('flattens pages and ignores marker comments from other authors', () => {
    const trustedState = {
      cache: {
        '1:abc123': {
          number: 1,
          breaking: 'yes',
          security: false,
          dependency: 'example',
          reason: 'An API was removed.',
        },
      },
      announced: ['1:abc123'],
    };
    const marker = '<!-- renovate-pr-report:sticky -->';
    const pages = [
      [
        {
          id: 1,
          user: { login: 'code-infra-renovate[bot]' },
          body: `${marker}\n<!-- renovate-pr-report-state: ${JSON.stringify(trustedState)} -->`,
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
      [
        {
          id: 2,
          user: { login: 'someone-else' },
          body: `${marker}\n<!-- renovate-pr-report-state: {"cache":{},"announced":[]} -->`,
          created_at: '2026-01-02T00:00:00Z',
        },
      ],
    ];

    const comments = selectTrustedComments(pages, 'code-infra-renovate');

    expect(comments.map((comment) => comment.id)).toEqual([1]);
    expect(parseReportState(comments, marker)).toEqual(trustedState);
  });
});

describe('Renovate PR report rendering', () => {
  const triagedPullRequest = {
    number: 1,
    title: 'Bump example',
    url: 'https://github.com/example/repository/pull/1',
    sha: 'abc123',
    ageDays: 1,
    lockfileMaintenance: false,
    bump: 'major',
    heuristicHit: true,
    analysisCandidate: true,
    pending: false,
    security: false,
    blockers: [],
  };

  it('uses the breaking-change heuristic when the LLM pass is disabled', () => {
    const report = runReport({ triaged: [triagedPullRequest] });

    expect(report).toContain('#### Needs attention (1)');
    expect(report).toContain('possibly breaking');
    expect(report).toContain('#### Ready to merge (0)');
  });

  it('fails closed when the LLM omits an analysis candidate', () => {
    const report = runReport({
      triaged: [{ ...triagedPullRequest, heuristicHit: false }],
      verdicts: [],
    });

    expect(report).toContain('#### Needs attention (1)');
    expect(report).toContain('possibly breaking');
  });
});
