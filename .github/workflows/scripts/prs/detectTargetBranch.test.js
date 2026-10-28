import { describe, it, expect, vi, afterEach } from 'vitest';
import detectTargetBranch from './detectTargetBranch';

/**
 * Builds a fake `@actions/core` that records `setOutput` calls and the `setFailed` reason.
 */
function createCore() {
  const outputs = {};
  return {
    outputs,
    info: vi.fn(),
    error: vi.fn(),
    setOutput: vi.fn((name, value) => {
      outputs[name] = value;
    }),
    setFailed: vi.fn(),
  };
}

const context = { repo: { owner: 'mui', repo: 'mui-x' }, issue: { number: 42 } };

/**
 * A merged PR carrying the usual labels, overridable per test.
 */
function createPr(overrides = {}) {
  return {
    number: 6,
    merged: true,
    merge_commit_sha: 'd29fc6b54a33d35ff6f090d1db54366b29d2595e',
    title: 'Fix something',
    user: { login: 'alice' },
    head: { ref: 'feature/x', label: 'alice:feature/x' },
    labels: [{ name: 'needs cherry-pick' }, { name: 'v8.x' }, { name: 'scope: pickers' }],
    requested_reviewers: [],
    ...overrides,
  };
}

function createGithub(pr, reviews = []) {
  return {
    rest: {
      pulls: {
        get: vi.fn(async () => ({ data: pr })),
        listReviews: vi.fn(async () => ({ data: reviews })),
      },
      issues: { createComment: vi.fn(async () => ({})) },
    },
  };
}

/** Simulates the env the workflow passes: inputs are empty strings when not dispatched manually. */
function stubDispatch({ prNumber = '', targetBranch = '' } = {}) {
  vi.stubEnv('PR_NUMBER', prNumber);
  vi.stubEnv('TARGET_BRANCH', targetBranch);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('detectTargetBranch', () => {
  describe('manual dispatch', () => {
    it('cherry-picks only the dispatched branch, even when it is also a PR label', async () => {
      const core = createCore();
      // The PR is labelled `v8.x` and `v7.x`; a manual run for `v8.x` must not duplicate it
      // nor pull in `v7.x`, otherwise the matrix races two jobs on the same branch.
      const pr = createPr({
        labels: [{ name: 'needs cherry-pick' }, { name: 'v8.x' }, { name: 'v7.x' }],
      });
      stubDispatch({ prNumber: '6', targetBranch: 'v8.x' });

      await detectTargetBranch({ core, context, github: createGithub(pr) });

      expect(core.outputs.TARGET_BRANCHES).toEqual(['v8.x']);
      expect(core.setFailed).not.toHaveBeenCalled();
    });

    it('fails fast when the named PR is not merged', async () => {
      const core = createCore();
      const pr = createPr({ merged: false, merge_commit_sha: null });
      stubDispatch({ prNumber: '6', targetBranch: 'v8.x' });

      await detectTargetBranch({ core, context, github: createGithub(pr) });

      expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('not merged'));
      expect(core.outputs.TARGET_BRANCHES).toBeUndefined();
    });

    it('exposes the PR details the cherry-pick job needs', async () => {
      const core = createCore();
      const pr = createPr({
        number: 6,
        merge_commit_sha: 'abc1234',
        title: 'Fix the thing',
        user: { login: 'octocat' },
      });
      stubDispatch({ prNumber: '6', targetBranch: 'v8.x' });

      await detectTargetBranch({ core, context, github: createGithub(pr) });

      expect(core.outputs.PR_NUMBER).toBe(6);
      expect(core.outputs.MERGE_COMMIT_SHA).toBe('abc1234');
      expect(core.outputs.PR_TITLE).toBe('Fix the thing');
      expect(core.outputs.PR_AUTHOR).toBe('octocat');
    });
  });

  describe('automatic trigger', () => {
    it('targets every `vN.x` label on the PR', async () => {
      const core = createCore();
      const pr = createPr({
        labels: [{ name: 'needs cherry-pick' }, { name: 'v8.x' }, { name: 'v7.x' }],
      });
      stubDispatch(); // no inputs -> automatic

      await detectTargetBranch({ core, context, github: createGithub(pr) });

      expect(core.outputs.TARGET_BRANCHES).toEqual(['v8.x', 'v7.x']);
    });

    it('adds `master` when the PR comes from a version branch', async () => {
      const core = createCore();
      const pr = createPr({
        labels: [{ name: 'needs cherry-pick' }],
        head: { ref: 'v8.x', label: 'mui:v8.x' },
      });
      stubDispatch();

      await detectTargetBranch({ core, context, github: createGithub(pr) });

      expect(core.outputs.TARGET_BRANCHES).toEqual(['master']);
    });

    it('produces no targets when the PR has no version branch to cherry-pick to', async () => {
      const core = createCore();
      const pr = createPr({ labels: [{ name: 'needs cherry-pick' }, { name: 'scope: pickers' }] });
      stubDispatch();

      await detectTargetBranch({ core, context, github: createGithub(pr) });

      expect(core.outputs.TARGET_BRANCHES).toBe('');
    });
  });

  it('sets the cherry-pick label plus the PR labels, minus the routing labels', async () => {
    const core = createCore();
    const pr = createPr({
      labels: [
        { name: 'needs cherry-pick' },
        { name: 'v8.x' },
        { name: 'scope: pickers' },
        { name: 'bug' },
      ],
    });
    stubDispatch({ prNumber: '6', targetBranch: 'v8.x' });

    await detectTargetBranch({ core, context, github: createGithub(pr) });

    // `needs cherry-pick` and the `vN.x` routing labels are dropped; `cherry-pick` is added.
    expect(core.outputs.LABELS).toBe('cherry-pick,scope: pickers,bug');
  });

  it('collects the author, requested reviewers and approvers, de-duplicated', async () => {
    const core = createCore();
    const pr = createPr({
      user: { login: 'alice' },
      requested_reviewers: [{ login: 'bob' }],
    });
    const reviews = [
      { state: 'APPROVED', user: { login: 'carol' } },
      { state: 'APPROVED', user: { login: 'carol' } }, // duplicate approval
      { state: 'COMMENTED', user: { login: 'dave' } }, // not an approval
      { state: 'APPROVED', user: null }, // deleted account
    ];
    stubDispatch({ prNumber: '6', targetBranch: 'v8.x' });

    await detectTargetBranch({ core, context, github: createGithub(pr, reviews) });

    expect(core.outputs.REVIEWERS).toBe('alice,bob,carol');
  });
});
