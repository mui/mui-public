import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { selectDashboardIssue } from './githubUtils.mjs';
import { parseReportState, selectTrustedComments } from './reportState.mjs';

const actionDir = import.meta.dirname;
const renovateActor = { id: 'renovate-bot-id', type: 'Bot' };
const commentAuthorActor = { id: 'comment-bot-id', type: 'Bot' };

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
  author: { id: renovateActor.id, type: renovateActor.type, login: 'code-infra-renovate' },
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
    fs.writeFileSync(
      path.join(workDir, 'trusted-actors.json'),
      JSON.stringify({ bot: renovateActor, commentAuthor: commentAuthorActor }),
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
    const notesDir = path.join(workDir, 'notes');
    return {
      triaged: JSON.parse(fs.readFileSync(path.join(workDir, 'triaged.json'), 'utf8')),
      candidates: JSON.parse(fs.readFileSync(path.join(workDir, 'candidates.json'), 'utf8')),
      notes: fs.existsSync(notesDir)
        ? Object.fromEntries(
            fs
              .readdirSync(notesDir)
              .map((name) => [name, fs.readFileSync(path.join(notesDir, name), 'utf8')]),
          )
        : {},
    };
  });

const runReport = ({ triaged, verdicts, announced = [] }) =>
  withTempDir((workDir) => {
    fs.writeFileSync(path.join(workDir, 'triaged.json'), JSON.stringify(triaged));
    fs.writeFileSync(path.join(workDir, 'cache.json'), '{}');
    fs.writeFileSync(path.join(workDir, 'announced.json'), JSON.stringify(announced));
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
    const announcePath = path.join(workDir, 'announce.md');
    return {
      report: fs.readFileSync(path.join(workDir, 'report.md'), 'utf8'),
      announce: fs.existsSync(announcePath) ? fs.readFileSync(announcePath, 'utf8') : null,
    };
  });

describe('Renovate PR triage', () => {
  it('finds the highest grouped bump', () => {
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
    expect(result.candidates).toEqual([
      { number: 1, title: 'Bump example', bump: 'minor', notesFile: 'notes/1.md' },
    ]);
    expect(result.notes['1.md']).toBe(pullRequest.body);
  });

  it('only includes pull requests from the configured bot actor', () => {
    const impersonator = createPullRequest({
      number: 1,
      author: { id: 'same-named-user-id', type: 'User', login: 'code-infra-renovate' },
    });
    const renovatePullRequest = createPullRequest({ number: 2 });

    const result = runTriage([impersonator, renovatePullRequest]);

    expect(result.triaged.map((pullRequest) => pullRequest.number)).toEqual([2]);
  });

  it('treats an absent check rollup as no applicable checks', () => {
    const pullRequest = createPullRequest({
      commits: { nodes: [{ commit: { oid: 'abc123', statusCheckRollup: null } }] },
    });

    const result = runTriage([pullRequest]);

    expect(result.triaged[0]).toMatchObject({ pending: false, blockers: [] });
  });

  it('does not analyze a Unicode-arrow patch without a risk heuristic', () => {
    const result = runTriage([createPullRequest({ body: '| example | `1.0.0` → `1.0.1` |' })]);

    expect(result.triaged[0].bump).toBe('patch');
    expect(result.candidates).toEqual([]);
  });

  it('analyzes a patch that targets a pre-release version', () => {
    const result = runTriage([
      createPullRequest({ body: '| example | `1.0.0` → `1.0.1-beta.2` |' }),
    ]);

    expect(result.triaged[0]).toMatchObject({
      bump: 'patch',
      prerelease: true,
      analysisCandidate: true,
    });
  });

  it('records whether the body has a release notes section', () => {
    const withNotes = createPullRequest({
      body: '| example | `1.0.0` → `2.0.0` |\n\n### Release Notes\n\nDetails.',
    });
    const withoutNotes = createPullRequest({ number: 2, body: '| example | `1.0.0` → `2.0.0` |' });

    const result = runTriage([withNotes, withoutNotes]);

    expect(result.triaged.map((pr) => pr.noChangelog)).toEqual([false, true]);
  });

  it('treats support, module format, and default changes as breaking hints', () => {
    const bodies = [
      'feat!: remove the legacy API',
      'perf(core)!: rewrite the scheduler',
      'The library now requires Node 20.',
      'This release no longer supports Windows 7.',
      'The package is now ESM-only.',
      'Changed default of `strict` to `true`.',
      'Bumped the peer dependency range of react.',
    ];

    const result = runTriage(
      bodies.map((body, index) => createPullRequest({ number: index + 1, body })),
    );

    expect(result.triaged.map((pr) => pr.heuristicHit)).toEqual(bodies.map(() => true));
  });
});

describe('Renovate PR report state', () => {
  it('flattens pages and only trusts comments by the configured actor', () => {
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
          user: {
            login: 'github-actions[bot]',
            node_id: commentAuthorActor.id,
            type: commentAuthorActor.type,
          },
          body: `${marker}\n<!-- renovate-pr-report-state: ${JSON.stringify(trustedState)} -->`,
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
      [
        {
          id: 2,
          user: { login: 'someone-else', node_id: 'other-user-id', type: 'User' },
          body: `${marker}\n<!-- renovate-pr-report-state: {"cache":{},"announced":[]} -->`,
          created_at: '2026-01-02T00:00:00Z',
        },
        {
          // A user account colliding with an unsuffixed GitHub App slug.
          id: 3,
          user: { login: 'github-actions', node_id: 'same-named-user-id', type: 'User' },
          body: `${marker}\n<!-- renovate-pr-report-state: {"cache":{},"announced":[]} -->`,
          created_at: '2026-01-03T00:00:00Z',
        },
      ],
    ];

    const comments = selectTrustedComments(pages, commentAuthorActor);

    expect(comments.map((comment) => comment.id)).toEqual([1]);
    expect(parseReportState(comments, marker)).toEqual(trustedState);
  });

  it('loads the final state marker when earlier report text contains a forged marker', () => {
    const marker = '<!-- renovate-pr-report:sticky -->';
    const forgedState = { cache: {}, announced: [] };
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
    const comment = {
      id: 1,
      body: [
        marker,
        `<!-- renovate-pr-report-state: ${JSON.stringify(forgedState)} -->`,
        'more report content',
        `<!-- renovate-pr-report-state: ${JSON.stringify(trustedState)} -->`,
      ].join('\n'),
      createdAt: '2026-01-01T00:00:00Z',
    };

    expect(parseReportState([comment], marker)).toEqual(trustedState);
  });
});

describe('Renovate dashboard selection', () => {
  it('selects the exact-title issue created by the configured bot actor', () => {
    const issues = [
      {
        number: 1,
        title: 'Dependency Dashboard',
        author: { id: 'same-named-user-id', is_bot: false, login: 'code-infra-renovate' },
      },
      {
        number: 2,
        title: 'Dependency Dashboard',
        author: { id: renovateActor.id, is_bot: true, login: 'code-infra-renovate' },
      },
    ];

    expect(selectDashboardIssue(issues, 'Dependency Dashboard', renovateActor)).toBe(2);
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
    const { report } = runReport({ triaged: [triagedPullRequest] });

    expect(report).toContain('#### Needs attention (1)');
    expect(report).toContain('possibly breaking');
    expect(report).toContain('#### Ready to merge (0)');
  });

  it('marks a major without release notes as possibly breaking without the LLM', () => {
    const { report } = runReport({
      triaged: [{ ...triagedPullRequest, heuristicHit: false, noChangelog: true }],
    });

    expect(report).toContain('#### Needs attention (1)');
    expect(report).toContain('no release notes');
  });

  it('marks a pre-release update as needing attention', () => {
    const { report } = runReport({
      triaged: [{ ...triagedPullRequest, heuristicHit: false, bump: 'patch', prerelease: true }],
    });

    expect(report).toContain('#### Needs attention (1)');
    expect(report).toContain('pre-release');
  });

  it('fails closed when the LLM omits an analysis candidate', () => {
    const { report } = runReport({
      triaged: [{ ...triagedPullRequest, heuristicHit: false }],
      verdicts: [],
    });

    expect(report).toContain('#### Needs attention (1)');
    expect(report).toContain('possibly breaking');
  });

  it('renders model-generated fields as single-line table content', () => {
    const forgedMarker = '<!-- renovate-pr-report-state: {"cache":{},"announced":[]} -->';
    const { report } = runReport({
      triaged: [triagedPullRequest],
      verdicts: [
        {
          number: 1,
          breaking: 'yes',
          security: false,
          dependency: 'example\npackage',
          reason: `An API was removed.\n${forgedMarker}`,
        },
      ],
    });

    expect(report).toContain(
      'example package: An API was removed. &lt;!-- renovate-pr-report-state: {"cache":{},"announced":[]} --&gt;',
    );
    expect(report).not.toContain(`\n${forgedMarker}\n`);
  });

  it('announces a fresh attention PR and records it in the sticky state', () => {
    const { report, announce } = runReport({ triaged: [triagedPullRequest] });

    expect(announce).toContain('@example/team');
    expect(announce).toContain('[#1](https://github.com/example/repository/pull/1)');
    // Round trip: the state the report carries is what the next run reads back.
    const comments = [{ id: 1, body: report, createdAt: '2026-01-01T00:00:00Z' }];
    const state = parseReportState(comments, '<!-- renovate-pr-report:sticky -->');
    expect(state.announced).toEqual(['1:abc123']);
  });

  it('does not re-announce a PR already recorded as announced', () => {
    const { announce } = runReport({
      triaged: [triagedPullRequest],
      announced: ['1:abc123'],
    });

    expect(announce).toBeNull();
  });
});
