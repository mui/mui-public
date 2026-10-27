// @ts-check
import { describe, expect, it } from 'vitest';
import { context as workflowContext, getOctokit } from '@actions/github';
import { checkPullRequestBatch, getPullRequests } from './checkReleaseUpToDate';

const headSha = 'a'.repeat(40);
const context = {
  ...workflowContext,
  repo: { owner: 'mui', repo: 'material-ui' },
  issue: { owner: 'mui', repo: 'material-ui', number: 42 },
  eventName: 'pull_request_target',
  payload: { pull_request: { number: 42 } },
};
const batch = { bucket: 10, pulls: [{ number: 42, sha: headSha }] };

/** @param {{ labels?: string[], behind?: number, state?: string, base?: string, compareError?: boolean, listError?: boolean, pages?: {number: number, head: {sha: string}, labels: {name: string}[]}[][] }} [options] */
function createGithub({
  labels = ['release'],
  behind = 0,
  state = 'open',
  base = 'master',
  compareError = false,
  listError = false,
  pages,
} = {}) {
  const pr = {
    number: 42,
    state,
    base: { ref: base },
    head: { sha: headSha, repo: { full_name: 'contributor/material-ui' } },
    labels: labels.map((name) => ({ name })),
  };
  const responses = pages ?? (state === 'open' && base === 'master' ? [[pr]] : [[]]);
  /** @type {{sha: string, state: string, context: string}[]} */
  const statuses = [];
  /** @type {string[]} */
  const requests = [];
  const fetch = /** @type {typeof globalThis.fetch} */ (
    async (input, options) => {
      const url = new URL(String(input));
      requests.push(`${options?.method || 'GET'} ${url.pathname}${url.search}`);
      if (url.pathname.endsWith('/pulls/42')) {
        return Response.json(pr);
      }
      if (url.pathname.includes('/compare/')) {
        return compareError
          ? Response.json({ message: 'Comparison unavailable' }, { status: 503 })
          : Response.json({ behind_by: behind });
      }
      if (url.pathname.includes('/statuses/')) {
        statuses.push({
          sha: url.pathname.split('/').at(-1),
          ...JSON.parse(String(options?.body)),
        });
        return Response.json({}, { status: 201 });
      }
      if (url.pathname.endsWith('/pulls')) {
        if (listError) {
          return Response.json({ message: 'PR list unavailable' }, { status: 503 });
        }
        const page = Number(url.searchParams.get('page') || 1);
        /** @type {Record<string, string>} */ const headers =
          page < responses.length
            ? {
                link: `<https://api.github.com/repos/mui/material-ui/pulls?state=open&base=master&per_page=100&page=${page + 1}>; rel="next"`,
              }
            : {};
        return Response.json(responses[page - 1], { headers });
      }
      throw new Error(`Unexpected request: ${url}`);
    }
  );
  return { github: getOctokit('test-token', { request: { fetch } }), statuses, requests };
}

describe('release branch freshness', () => {
  it('passes an unlabeled PR without comparing commits and posts on its head', async () => {
    const { github, statuses, requests } = createGithub({ labels: [] });
    await checkPullRequestBatch({ github, context, batch });
    expect(statuses.at(-1)).toEqual(
      expect.objectContaining({
        sha: headSha,
        context: 'Release branch up to date',
        state: 'success',
      }),
    );
    expect(requests).not.toContainEqual(expect.stringContaining('/compare/'));
  });

  it.each([0, 1, 12])('checks ancestry when the PR is %i commits behind', async (behind) => {
    const { github, statuses, requests } = createGithub({ behind });
    await checkPullRequestBatch({ github, context, batch });
    expect(statuses.map((status) => status.state)).toEqual([
      'pending',
      behind === 0 ? 'success' : 'failure',
    ]);
    expect(requests).toContainEqual(expect.stringContaining(`/compare/master...${headSha}`));
  });

  it('uses current labels when a release label was removed', async () => {
    const { github, statuses } = createGithub({ labels: [] });
    await checkPullRequestBatch({
      github,
      context: {
        ...context,
        payload: { pull_request: { number: 42, labels: [{ name: 'release' }] } },
      },
      batch,
    });
    expect(statuses.at(-1)?.state).toBe('success');
  });

  it.each([{ state: 'closed' }, { base: 'next' }])(
    'clears the old head when its only PR is no longer eligible: %j',
    async (options) => {
      const { github, statuses } = createGithub(options);
      await checkPullRequestBatch({ github, context, batch });
      expect(statuses.at(-1)?.state).toBe('success');
    },
  );

  it.each([{ compareError: true }, { listError: true }])(
    'invalidates success when an API request fails: %j',
    async (options) => {
      const { github, statuses } = createGithub(options);
      await expect(checkPullRequestBatch({ github, context, batch })).rejects.toThrow(
        'unavailable',
      );
      expect(statuses.map((status) => status.state)).toEqual(['pending', 'error']);
    },
  );

  it('accepts another base branch and release label', async () => {
    const { github, statuses, requests } = createGithub({
      pages: [[{ number: 42, head: { sha: headSha }, labels: [{ name: 'ship' }] }]],
    });
    await checkPullRequestBatch({
      github,
      context,
      batch,
      baseBranch: 'next',
      releaseLabel: 'ship',
    });
    expect(statuses.at(-1)?.state).toBe('success');
    expect(requests).toContainEqual(expect.stringContaining(`/compare/next...${headSha}`));
  });

  it('selects the current head from a PR event', async () => {
    const { github } = createGithub();
    expect(await getPullRequests({ github, context })).toEqual([batch]);
  });

  it('finds release PRs across pages after a base branch push', async () => {
    const { github, requests } = createGithub({
      pages: [
        [
          { number: 42, head: { sha: headSha }, labels: [{ name: 'release' }] },
          { number: 43, head: { sha: headSha }, labels: [] },
        ],
        [{ number: 44, head: { sha: headSha }, labels: [{ name: 'release' }] }],
      ],
    });
    expect(
      await getPullRequests({
        github,
        context: { ...context, eventName: 'push', payload: { ref: 'refs/heads/master' } },
      }),
    ).toEqual([
      {
        bucket: 10,
        pulls: [
          { number: 42, sha: headSha },
          { number: 44, sha: headSha },
        ],
      },
    ]);
    expect(requests).toContainEqual(expect.stringContaining('base=master'));
    expect(requests).toHaveLength(2);
  });

  it('initializes all open PRs on a manual run', async () => {
    const { github } = createGithub({ labels: [] });
    expect(
      await getPullRequests({
        github,
        context: { ...context, eventName: 'workflow_dispatch', payload: {} },
      }),
    ).toEqual([batch]);
  });

  it('ignores pushes to another branch', async () => {
    const { github, requests } = createGithub();
    expect(
      await getPullRequests({
        github,
        context: { ...context, eventName: 'push', payload: { ref: 'refs/heads/feature' } },
      }),
    ).toEqual([]);
    expect(requests).toEqual([]);
  });

  it.each([false, true])(
    'prevents a shared-head bypass in either event order (unlabeled first: %s)',
    async (unlabeledFirst) => {
      const pages = [
        [
          { number: 42, head: { sha: headSha }, labels: [] },
          { number: 43, head: { sha: headSha }, labels: [{ name: 'release' }] },
        ],
      ];
      const unlabeled = createGithub({ labels: [], behind: 2, pages });
      const release = createGithub({ behind: 2, pages });
      for (const run of unlabeledFirst ? [unlabeled, release] : [release, unlabeled]) {
        // eslint-disable-next-line no-await-in-loop -- Replay events in order to exercise shared-status overwrites.
        await checkPullRequestBatch({ github: run.github, context, batch });
        expect(run.statuses.at(-1)?.state).toBe('failure');
      }
    },
  );

  it('bounds the initialization matrix while retaining all PRs', async () => {
    const pulls = Array.from({ length: 300 }, (_, index) => ({
      number: index + 1,
      head: { sha: index.toString(16).padStart(40, '0') },
      labels: [],
    }));
    const { github } = createGithub({ pages: [pulls] });
    const batches = await getPullRequests({
      github,
      context: { ...context, eventName: 'workflow_dispatch', payload: {} },
    });
    expect(batches.length).toBeLessThanOrEqual(16);
    expect(batches.flatMap((entry) => entry.pulls)).toHaveLength(300);
  });

  it('refreshes the entire bucket so replaced pending jobs do not lose updates', async () => {
    const otherSha = `${'b'.repeat(38)}aa`;
    const { github, statuses } = createGithub({
      pages: [
        [
          { number: 42, head: { sha: headSha }, labels: [] },
          { number: 43, head: { sha: otherSha }, labels: [{ name: 'release' }] },
        ],
      ],
      behind: 1,
    });
    await checkPullRequestBatch({ github, context, batch });
    expect(statuses.filter((status) => status.state !== 'pending')).toEqual([
      expect.objectContaining({ sha: headSha, state: 'success' }),
      expect.objectContaining({ sha: otherSha, state: 'failure' }),
    ]);
  });
});
