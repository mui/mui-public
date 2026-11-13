// @ts-check
import { describe, expect, it } from 'vitest';
import { context as workflowContext, getOctokit } from '@actions/github';
import { checkReleaseUpToDate } from './checkReleaseUpToDate';

const headSha = 'a'.repeat(40);
const context = {
  ...workflowContext,
  repo: { owner: 'mui', repo: 'material-ui' },
  issue: { owner: 'mui', repo: 'material-ui', number: 42 },
  eventName: 'pull_request_target',
  payload: { pull_request: { number: 42, head: { sha: headSha } } },
  runId: 1234,
};

/** @param {{ labels?: string[], behind?: number, state?: string, base?: string, compareError?: boolean, listError?: boolean, listErrorPage?: number, statusReadError?: boolean, statusWriteError?: string, initialStatuses?: {sha: string, state: string, context: string, description?: string}[], pages?: {number: number, head: {sha: string}, labels: {name: string}[]}[][] }} [options] */
function createGithub({
  labels = ['release'],
  behind = 0,
  state = 'open',
  base = 'master',
  compareError = false,
  listError = false,
  listErrorPage,
  statusReadError = false,
  statusWriteError,
  initialStatuses = [],
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
  /** @type {{sha: string, state: string, context: string, description?: string}[]} */
  const statuses = [...initialStatuses];
  /** @type {string[]} */
  const requests = [];
  const fetch = /** @type {typeof globalThis.fetch} */ (
    async (input, options) => {
      const url = new URL(String(input));
      requests.push(`${options?.method || 'GET'} ${url.pathname}${url.search}`);
      if (url.pathname === '/graphql') {
        if (statusReadError) {
          return Response.json({ message: 'Statuses unavailable' }, { status: 503 });
        }
        const { query, variables } = JSON.parse(String(options?.body));
        expect(variables).toEqual({
          owner: 'mui',
          repo: 'material-ui',
          context: 'Release branch up to date',
        });
        expect(query).toContain('context(name: $context)');
        const repository = Object.fromEntries(
          [...query.matchAll(/(head\d+): object\(oid: "([a-f\d]{40})"\)/g)].map((match) => {
            const status = statuses.findLast(
              (entry) => entry.sha === match[2] && entry.context === variables.context,
            );
            return [
              match[1],
              {
                status: status
                  ? {
                      context: {
                        state: status.state.toUpperCase(),
                        description: status.description ?? null,
                      },
                    }
                  : null,
              },
            ];
          }),
        );
        return Response.json({ data: { repository } });
      }
      if (url.pathname.includes('/compare/')) {
        return compareError
          ? Response.json({ message: 'Comparison unavailable' }, { status: 503 })
          : Response.json({ behind_by: behind });
      }
      if (url.pathname.includes('/statuses/')) {
        if (url.pathname.endsWith(`/statuses/${statusWriteError}`)) {
          return Response.json({ message: 'Status write unavailable' }, { status: 503 });
        }
        statuses.push({
          sha: url.pathname.split('/').at(-1),
          ...JSON.parse(String(options?.body)),
        });
        return Response.json({}, { status: 201 });
      }
      if (url.pathname.endsWith('/pulls')) {
        const page = Number(url.searchParams.get('page') || 1);
        if (listError || page === listErrorPage) {
          return Response.json({ message: 'PR list unavailable' }, { status: 503 });
        }
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
  it('reconciles every open head even when a pending event for another head was replaced', async () => {
    const otherSha = 'b'.repeat(40);
    const { github, statuses } = createGithub({
      behind: 1,
      pages: [
        [
          { number: 42, head: { sha: headSha }, labels: [] },
          { number: 43, head: { sha: otherSha }, labels: [{ name: 'release' }] },
        ],
      ],
    });
    await checkReleaseUpToDate({ github, context });
    expect(statuses).toEqual([
      expect.objectContaining({ sha: headSha, state: 'success' }),
      expect.objectContaining({ sha: otherSha, state: 'failure' }),
    ]);
  });

  it('invalidates known heads when both discovery and status reads fail, continuing after a failed write', async () => {
    const previousSha = 'b'.repeat(40);
    const { github, statuses, requests } = createGithub({
      listError: true,
      statusReadError: true,
      statusWriteError: headSha,
    });
    await expect(
      checkReleaseUpToDate({
        github,
        context: {
          ...context,
          payload: {
            action: 'synchronize',
            before: previousSha,
            pull_request: { number: 42, head: { sha: headSha } },
          },
        },
      }),
    ).rejects.toThrow();
    expect(requests).toContainEqual(expect.stringContaining(`/statuses/${headSha}`));
    expect(statuses).toEqual([expect.objectContaining({ sha: previousSha, state: 'error' })]);
  });

  it('clears a previous head after synchronization even when it has no remaining PR', async () => {
    const previousSha = 'b'.repeat(40);
    const { github, statuses } = createGithub({ behind: 1 });
    await checkReleaseUpToDate({
      github,
      context: {
        ...context,
        payload: {
          action: 'synchronize',
          before: previousSha,
          pull_request: { number: 42, head: { sha: headSha } },
        },
      },
    });
    expect(statuses).toContainEqual(
      expect.objectContaining({ sha: previousSha, state: 'success' }),
    );
    expect(statuses).toContainEqual(expect.objectContaining({ sha: headSha, state: 'failure' }));
  });

  it('passes an unlabeled PR without comparing commits and posts on its head', async () => {
    const { github, statuses, requests } = createGithub({ labels: [] });
    await checkReleaseUpToDate({ github, context });
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
    await checkReleaseUpToDate({ github, context });
    expect(statuses.map((status) => status.state)).toEqual([behind === 0 ? 'success' : 'failure']);
    expect(requests).toContainEqual(expect.stringContaining(`/compare/master...${headSha}`));
  });

  it('uses current labels when a release label was removed', async () => {
    const { github, statuses } = createGithub({ labels: [] });
    await checkReleaseUpToDate({
      github,
      context: {
        ...context,
        payload: { pull_request: { number: 42, labels: [{ name: 'release' }] } },
      },
    });
    expect(statuses.at(-1)?.state).toBe('success');
  });

  it.each([{ state: 'closed' }, { base: 'next' }])(
    'clears the old head when its only PR is no longer eligible: %j',
    async (options) => {
      const { github, statuses } = createGithub(options);
      await checkReleaseUpToDate({ github, context });
      expect(statuses.at(-1)?.state).toBe('success');
    },
  );

  it.each([{ compareError: true }, { listError: true }])(
    'invalidates success when an API request fails: %j',
    async (options) => {
      const { github, statuses } = createGithub({
        ...options,
        initialStatuses: [
          {
            sha: headSha,
            state: 'success',
            context: 'Release branch up to date',
            description: 'This release PR contains the latest master commits.',
          },
        ],
      });
      await expect(checkReleaseUpToDate({ github, context })).rejects.toThrow(/freshness/i);
      expect(statuses.map((status) => status.state)).toEqual(['success', 'error']);
    },
  );

  it('accepts another base branch and release label', async () => {
    const { github, statuses, requests } = createGithub({
      pages: [[{ number: 42, head: { sha: headSha }, labels: [{ name: 'ship' }] }]],
    });
    await checkReleaseUpToDate({
      github,
      context,
      baseBranch: 'next',
      releaseLabel: 'ship',
    });
    expect(statuses.at(-1)?.state).toBe('success');
    expect(requests).toContainEqual(expect.stringContaining(`/compare/next...${headSha}`));
  });

  it('ignores pushes to another branch', async () => {
    const { github, requests } = createGithub();
    await checkReleaseUpToDate({
      github,
      context: { ...context, eventName: 'push', payload: { ref: 'refs/heads/feature' } },
    });
    expect(requests).toEqual([]);
  });

  it.each(['push', 'workflow_dispatch', 'schedule'])(
    'reconciles labeled and unlabeled PRs across pages on %s',
    async (eventName) => {
      const otherSha = 'b'.repeat(40);
      const { github, statuses, requests } = createGithub({
        behind: 2,
        pages: [
          [{ number: 42, head: { sha: headSha }, labels: [] }],
          [{ number: 43, head: { sha: otherSha }, labels: [{ name: 'release' }] }],
        ],
      });
      await checkReleaseUpToDate({
        github,
        context: {
          ...context,
          eventName,
          payload: { ref: 'refs/heads/master', after: 'c'.repeat(40) },
        },
      });
      expect(statuses).toEqual([
        expect.objectContaining({ sha: headSha, state: 'success' }),
        expect.objectContaining({ sha: otherSha, state: 'failure' }),
      ]);
      expect(requests).toContainEqual(expect.stringContaining('page=2'));
      expect(requests).toContainEqual(expect.stringContaining(`/compare/master...${otherSha}`));
    },
  );

  it('invalidates heads from earlier pages when base-push discovery fails later', async () => {
    const { github, statuses } = createGithub({
      listErrorPage: 2,
      pages: [[{ number: 42, head: { sha: headSha }, labels: [{ name: 'release' }] }], []],
      initialStatuses: [{ sha: headSha, state: 'success', context: 'Release branch up to date' }],
    });
    await expect(
      checkReleaseUpToDate({
        github,
        context: {
          ...context,
          eventName: 'push',
          payload: { ref: 'refs/heads/master' },
        },
      }),
    ).rejects.toThrow(/freshness/i);
    expect(statuses.map((status) => status.state)).toEqual(['success', 'error']);
  });

  it('publishes the computed result even when status history cannot be read', async () => {
    const { github, statuses } = createGithub({ statusReadError: true, behind: 1 });
    await checkReleaseUpToDate({ github, context });
    expect(statuses).toEqual([expect.objectContaining({ sha: headSha, state: 'failure' })]);
  });

  it('continues checking other heads when a status cannot be written', async () => {
    const otherSha = 'b'.repeat(40);
    const { github, statuses } = createGithub({
      statusWriteError: headSha,
      pages: [
        [
          { number: 42, head: { sha: headSha }, labels: [] },
          { number: 43, head: { sha: otherSha }, labels: [{ name: 'release' }] },
        ],
      ],
    });
    await expect(checkReleaseUpToDate({ github, context })).rejects.toThrow(/freshness/i);
    expect(statuses).toEqual([expect.objectContaining({ sha: otherSha, state: 'success' })]);
  });

  it('finds an unchanged freshness status despite hundreds of unrelated statuses', async () => {
    const initialStatuses = [
      {
        sha: headSha,
        state: 'success',
        context: 'Release branch up to date',
        description: 'This release PR contains the latest master commits.',
      },
      ...Array.from({ length: 100 }, (_, index) => ({
        sha: headSha,
        state: 'success',
        context: `Other check ${index}`,
      })),
    ];
    const { github, statuses, requests } = createGithub({ initialStatuses });
    await checkReleaseUpToDate({ github, context });
    expect(statuses).toHaveLength(101);
    expect(requests).toContain('POST /graphql');
  });

  it('does not duplicate a result on consecutive reconciliations', async () => {
    const { github, statuses } = createGithub({ behind: 1 });
    await checkReleaseUpToDate({ github, context });
    await checkReleaseUpToDate({ github, context });
    expect(statuses.map((status) => status.state)).toEqual(['failure']);
  });

  it('reconciles hundreds of unchanged heads without a request per head', async () => {
    const pulls = Array.from({ length: 120 }, (_, index) => ({
      number: index + 1,
      head: { sha: index.toString(16).padStart(40, '0') },
      labels: [],
    }));
    const { github, statuses, requests } = createGithub({
      pages: [pulls],
      initialStatuses: pulls.map((pr) => ({
        sha: pr.head.sha,
        state: 'success',
        context: 'Release branch up to date',
        description: 'No open release PR targets this branch with this head commit.',
      })),
    });
    await checkReleaseUpToDate({
      github,
      context: { ...context, eventName: 'workflow_dispatch', payload: {} },
    });
    expect(statuses).toHaveLength(120);
    expect(requests.length).toBeLessThan(10);
  });

  it.each([false, true])(
    'keeps the release requirement across pages in either PR order (release first: %s)',
    async (releaseFirst) => {
      const release = { number: 42, head: { sha: headSha }, labels: [{ name: 'release' }] };
      const unlabeled = { number: 43, head: { sha: headSha }, labels: [] };
      const { github, statuses } = createGithub({
        behind: 2,
        pages: releaseFirst ? [[release], [unlabeled]] : [[unlabeled], [release]],
      });
      await checkReleaseUpToDate({ github, context });
      expect(statuses).toEqual([expect.objectContaining({ sha: headSha, state: 'failure' })]);
    },
  );

  it('refreshes all heads so replaced pending jobs do not lose updates', async () => {
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
    await checkReleaseUpToDate({ github, context });
    expect(statuses.filter((status) => status.state !== 'pending')).toEqual([
      expect.objectContaining({ sha: headSha, state: 'success' }),
      expect.objectContaining({ sha: otherSha, state: 'failure' }),
    ]);
  });

  it('does not republish unchanged statuses on repeated reconciliation', async () => {
    const otherSha = `${'b'.repeat(38)}aa`;
    const { github, statuses, requests } = createGithub({
      labels: [],
      pages: [
        [
          { number: 42, head: { sha: headSha }, labels: [] },
          { number: 43, head: { sha: otherSha }, labels: [{ name: 'release' }] },
        ],
      ],
      behind: 1,
      initialStatuses: [
        {
          sha: headSha,
          state: 'success',
          context: 'Release branch up to date',
          description: 'No open release PR targets this branch with this head commit.',
        },
        {
          sha: otherSha,
          state: 'failure',
          context: 'Release branch up to date',
          description: 'Merge or rebase master into this release PR.',
        },
      ],
    });
    await checkReleaseUpToDate({ github, context });
    expect(statuses).toHaveLength(2);
    expect(requests).not.toContainEqual(expect.stringContaining(`/statuses/${headSha}`));
    expect(requests).not.toContainEqual(expect.stringContaining(`/statuses/${otherSha}`));
  });
});
