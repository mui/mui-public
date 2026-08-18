import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCircleCiJob, parseGitHubJob, tailText } from './failureLogUtils.mjs';
import { parseVerdictState, selectTrustedComments, serializeVerdictState } from './reportState.mjs';

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

const runTriage = (pullRequests, { cache = {} } = {}) =>
  withTempDir((workDir) => {
    fs.writeFileSync(
      path.join(workDir, 'prs.json'),
      JSON.stringify([{ data: { repository: { pullRequests: { nodes: pullRequests } } } }]),
    );
    fs.writeFileSync(
      path.join(workDir, 'trusted-actors.json'),
      JSON.stringify({ bot: renovateActor, commentAuthor: commentAuthorActor }),
    );
    fs.writeFileSync(path.join(workDir, 'cache.json'), JSON.stringify(cache));
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

const runReport = ({ triaged, verdicts, verdictComments = {} }) =>
  withTempDir((workDir) => {
    fs.writeFileSync(path.join(workDir, 'triaged.json'), JSON.stringify(triaged));
    fs.writeFileSync(path.join(workDir, 'cache.json'), '{}');
    fs.writeFileSync(path.join(workDir, 'verdict-comments.json'), JSON.stringify(verdictComments));
    fs.writeFileSync(path.join(workDir, 'output'), '');
    if (verdicts) {
      fs.writeFileSync(path.join(workDir, 'verdicts.json'), JSON.stringify(verdicts));
    }
    execFileSync(process.execPath, [path.join(actionDir, 'renderPrComments.mjs')], {
      env: {
        ...process.env,
        WORK_DIR: workDir,
        MAX_AGE_DAYS: '10',
        BOT_LOGIN: 'code-infra-renovate[bot]',
        VERDICT_MARKER: '<!-- renovate-pr-report:verdict -->',
        MENTION: '@example/team',
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'example/repository',
        GITHUB_RUN_ID: '1',
        GITHUB_WORKFLOW: 'Renovate PR report',
        GITHUB_OUTPUT: path.join(workDir, 'output'),
      },
    });
    const commentsDir = path.join(workDir, 'comments');
    return {
      report: fs.readFileSync(path.join(workDir, 'report.md'), 'utf8'),
      targets: JSON.parse(fs.readFileSync(path.join(workDir, 'comment-targets.json'), 'utf8')),
      comments: fs.existsSync(commentsDir)
        ? Object.fromEntries(
            fs
              .readdirSync(commentsDir)
              .map((name) => [name, fs.readFileSync(path.join(commentsDir, name), 'utf8')]),
          )
        : {},
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

  it('collects failing checks from both check runs and commit statuses', () => {
    const pullRequest = createPullRequest({
      // A failing patch: the CI failure alone makes it an analysis candidate.
      body: '| example | `1.0.0` → `1.0.1` |',
      commits: {
        nodes: [
          {
            commit: {
              oid: 'abc123',
              statusCheckRollup: {
                state: 'FAILURE',
                contexts: {
                  nodes: [
                    {
                      kind: 'CheckRun',
                      name: 'test (ubuntu-latest)',
                      conclusion: 'FAILURE',
                      detailsUrl: 'https://github.com/example/repository/actions/runs/1/job/2',
                    },
                    {
                      kind: 'CheckRun',
                      name: 'lint',
                      conclusion: 'SUCCESS',
                      detailsUrl: 'https://github.com/example/repository/actions/runs/1/job/3',
                    },
                    {
                      kind: 'StatusContext',
                      context: 'ci/circleci: test',
                      state: 'FAILURE',
                      targetUrl: 'https://circleci.com/gh/example/repository/77',
                    },
                    {
                      kind: 'StatusContext',
                      context: 'deploy/preview',
                      state: 'SUCCESS',
                      targetUrl: 'https://example.com',
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    });

    const result = runTriage([pullRequest]);

    expect(result.triaged[0]).toMatchObject({
      bump: 'patch',
      analysisCandidate: true,
      failingChecks: [
        {
          name: 'test (ubuntu-latest)',
          url: 'https://github.com/example/repository/actions/runs/1/job/2',
        },
        { name: 'ci/circleci: test', url: 'https://circleci.com/gh/example/repository/77' },
      ],
    });
    expect(result.candidates[0].failureFile).toBe('failures/1.md');
  });

  it('reanalyzes a failing PR whose cached verdict predates the failure', () => {
    const failingCheck = {
      kind: 'CheckRun',
      name: 'test',
      conclusion: 'FAILURE',
      detailsUrl: 'https://github.com/example/repository/actions/runs/1/job/2',
    };
    const pullRequest = createPullRequest({
      body: '| example | `1.0.0` → `2.0.0` |',
      commits: {
        nodes: [
          {
            commit: {
              oid: 'abc123',
              statusCheckRollup: { state: 'FAILURE', contexts: { nodes: [failingCheck] } },
            },
          },
        ],
      },
    });
    const greenVerdict = {
      number: 1,
      breaking: 'no',
      security: false,
      dependency: '',
      reason: '',
      ciCulprit: '',
      ciFix: '',
    };

    const stale = runTriage([pullRequest], { cache: { '1:abc123': greenVerdict } });
    const diagnosed = runTriage([pullRequest], {
      cache: { '1:abc123': { ...greenVerdict, ciFix: 'Unrelated: the test is flaky.' } },
    });

    expect(stale.candidates).toHaveLength(1);
    expect(diagnosed.candidates).toEqual([]);
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

describe('Renovate PR verdict state', () => {
  const marker = '<!-- renovate-pr-report:verdict -->';
  const verdict = {
    number: 1,
    breaking: 'yes',
    security: false,
    dependency: 'example',
    reason: 'An API was removed.',
    ciCulprit: '',
    ciFix: '',
  };

  it('only trusts comments by the configured actor', () => {
    const comments = selectTrustedComments(
      [
        {
          databaseId: 1,
          body: 'trusted',
          author: {
            login: 'github-actions[bot]',
            type: commentAuthorActor.type,
            id: commentAuthorActor.id,
          },
        },
        {
          databaseId: 2,
          body: 'someone else',
          author: { login: 'someone-else', type: 'User', id: 'other-user-id' },
        },
        {
          // A user account colliding with an unsuffixed GitHub App slug.
          databaseId: 3,
          body: 'impersonator',
          author: { login: 'github-actions', type: 'User', id: 'same-named-user-id' },
        },
      ],
      commentAuthorActor,
    );

    expect(comments).toEqual([{ id: 1, body: 'trusted' }]);
  });

  it('reads the state from the last line, ignoring forged markers in the body', () => {
    const comment = {
      id: 5,
      body: [
        marker,
        serializeVerdictState({ sha: 'forged', verdict: null }),
        'more comment content',
        serializeVerdictState({ sha: 'abc123', verdict }),
      ].join('\n'),
    };

    expect(parseVerdictState([comment], marker)).toEqual({
      commentId: 5,
      sha: 'abc123',
      verdict,
      reported: null,
    });
  });

  it('round-trips the reported signature used for re-ping detection', () => {
    const reported = { breaking: 'yes', security: true, dependency: 'example', ciCulprit: '' };
    const comment = {
      id: 6,
      body: [marker, serializeVerdictState({ sha: 'abc123', verdict: null, reported })].join('\n'),
    };

    expect(parseVerdictState([comment], marker)).toEqual({
      commentId: 6,
      sha: 'abc123',
      verdict: null,
      reported,
    });
  });

  it('keeps the comment id but drops a malformed verdict', () => {
    const comment = {
      id: 7,
      body: [marker, serializeVerdictState({ sha: 'abc123', verdict: { number: 'x' } })].join('\n'),
    };

    expect(parseVerdictState([comment], marker)).toEqual({
      commentId: 7,
      sha: 'abc123',
      verdict: null,
      reported: null,
    });
  });

  it('returns no state when no trusted verdict comment exists', () => {
    expect(parseVerdictState([], marker)).toBeNull();
  });
});

describe('Renovate PR verdict comments', () => {
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

  it('comments a heuristic verdict with a mention when the LLM pass is disabled', () => {
    const { report, comments, targets } = runReport({ triaged: [triagedPullRequest] });

    expect(comments['1.md']).toContain('possibly breaking');
    expect(comments['1.md']).toContain('@example/team');
    expect(targets).toEqual([
      { number: 1, file: 'comments/1.md', commentId: null, recreate: false },
    ]);
    expect(report).toContain('#### Needs attention (1)');
  });

  it('marks a major without release notes as possibly breaking without the LLM', () => {
    const { comments } = runReport({
      triaged: [{ ...triagedPullRequest, heuristicHit: false, noChangelog: true }],
    });

    expect(comments['1.md']).toContain('no release notes');
  });

  it('marks a pre-release update as needing attention', () => {
    const { comments } = runReport({
      triaged: [{ ...triagedPullRequest, heuristicHit: false, bump: 'patch', prerelease: true }],
    });

    expect(comments['1.md']).toContain('pre-release');
  });

  it('fails closed when the LLM omits an analysis candidate', () => {
    const { comments } = runReport({
      triaged: [{ ...triagedPullRequest, heuristicHit: false }],
      verdicts: [],
    });

    expect(comments['1.md']).toContain('possibly breaking');
  });

  it('updates the comment in place when the same issue is still reported', () => {
    const { targets } = runReport({
      triaged: [triagedPullRequest],
      verdictComments: {
        1: {
          id: 555,
          reported: { breaking: 'unclear', security: false, dependency: '', ciCulprit: '' },
        },
      },
    });

    expect(targets).toEqual([
      { number: 1, file: 'comments/1.md', commentId: 555, recreate: false },
    ]);
  });

  it('recreates the comment to re-ping when a different issue is reported', () => {
    const { targets } = runReport({
      triaged: [triagedPullRequest],
      verdictComments: {
        1: {
          id: 555,
          reported: { breaking: 'no', security: false, dependency: '', ciCulprit: '' },
        },
      },
      verdicts: [
        {
          number: 1,
          breaking: 'yes',
          security: false,
          dependency: 'example',
          reason: 'Removed.',
          ciCulprit: '',
          ciFix: '',
        },
      ],
    });

    expect(targets).toEqual([{ number: 1, file: 'comments/1.md', commentId: 555, recreate: true }]);
  });

  it('does not recreate the comment when only the reason wording changed', () => {
    const { targets } = runReport({
      triaged: [triagedPullRequest],
      verdictComments: {
        1: {
          id: 555,
          reported: { breaking: 'yes', security: false, dependency: 'example', ciCulprit: '' },
        },
      },
      verdicts: [
        {
          number: 1,
          breaking: 'yes',
          security: false,
          dependency: 'example',
          reason: 'Reworded.',
          ciCulprit: '',
          ciFix: '',
        },
      ],
    });

    expect(targets[0]).toMatchObject({ commentId: 555, recreate: false });
  });

  it('does not comment on a quiet patch update', () => {
    const { comments, targets, report } = runReport({
      triaged: [
        { ...triagedPullRequest, bump: 'patch', heuristicHit: false, analysisCandidate: false },
      ],
    });

    expect(comments).toEqual({});
    expect(targets).toEqual([]);
    expect(report).toContain('#### Ready to merge (1)');
  });

  it('renders model-generated fields as single-line content that round-trips as state', () => {
    const verdict = {
      number: 1,
      breaking: 'yes',
      security: false,
      dependency: 'example\npackage',
      reason: `An API was removed.\n${serializeVerdictState({ sha: 'forged', verdict: null })}`,
      ciCulprit: '',
      ciFix: '',
    };
    const { comments } = runReport({ triaged: [triagedPullRequest], verdicts: [verdict] });
    const body = comments['1.md'];

    expect(body).toContain('example package: An API was removed.');
    // Round trip: the state the comment carries is what the next run reads back.
    const state = parseVerdictState([{ id: 1, body }], '<!-- renovate-pr-report:verdict -->');
    expect(state).toEqual({
      commentId: 1,
      sha: 'abc123',
      verdict,
      reported: { breaking: 'yes', security: false, dependency: 'example\npackage', ciCulprit: '' },
    });
  });

  it('includes the CI diagnosis when the PR has failing checks', () => {
    const { comments } = runReport({
      triaged: [
        {
          ...triagedPullRequest,
          heuristicHit: false,
          failingChecks: [{ name: 'test', url: 'https://example.com/run' }],
        },
      ],
      verdicts: [
        {
          number: 1,
          breaking: 'no',
          security: false,
          dependency: '',
          reason: '',
          ciCulprit: 'example',
          ciFix: 'Adapt to the renamed export.',
        },
      ],
    });

    expect(comments['1.md']).toContain('**CI failing** — example: Adapt to the renamed export.');
  });

  it('lists the failing checks when there is no CI diagnosis', () => {
    const { comments } = runReport({
      triaged: [
        {
          ...triagedPullRequest,
          failingChecks: [{ name: 'test (ubuntu-latest)', url: 'https://example.com/run' }],
        },
      ],
    });

    expect(comments['1.md']).toContain('**CI failing** — test (ubuntu-latest)');
  });
});

describe('Renovate failure log utilities', () => {
  it('parses a GitHub Actions job id from a check details url', () => {
    expect(
      parseGitHubJob('https://github.com/example/repository/actions/runs/123/job/456?pr=1'),
    ).toBe('456');
    expect(parseGitHubJob('https://example.com/other')).toBeNull();
  });

  it('parses a CircleCI job number from a status target url', () => {
    expect(parseCircleCiJob('https://circleci.com/gh/example/repository/789?query=1')).toBe('789');
    expect(parseCircleCiJob('https://github.com/example/repository/actions/runs/1')).toBeNull();
  });

  it('tails long logs by lines and characters', () => {
    const lines = Array.from({ length: 500 }, (unused, index) => `line ${index}`).join('\n');

    const tail = tailText(lines, 200, 15000);

    expect(tail.startsWith('line 300')).toBe(true);
    expect(tail.endsWith('line 499')).toBe(true);
    expect(tailText('x'.repeat(20), 10, 5)).toBe('xxxxx');
  });
});
