// @ts-check
/* eslint-disable no-await-in-loop -- Serialize GitHub requests to preserve status ordering and avoid secondary rate limits. */

/**
 * @typedef {Object} Options
 * @property {ReturnType<typeof import('@actions/github').getOctokit>} github
 * @property {typeof import('@actions/github').context} context
 * @property {string} [baseBranch]
 * @property {string} [releaseLabel]
 */
/** @typedef {{ bucket: number, pulls: { number: number, sha: string }[] }} Batch */

/** @param {string} sha */
const bucketFor = (sha) => Number.parseInt(sha.slice(-2), 16) % 16;

/** @param {Options} options @returns {Promise<Batch[]>} */
async function getPullRequests({
  github,
  context,
  baseBranch = 'master',
  releaseLabel = 'release',
}) {
  /** @type {{ number: number, head: { sha: string } }[]} */
  let pulls;
  if (context.eventName === 'pull_request_target') {
    const number = context.payload.pull_request?.number;
    if (!number) {
      throw new Error('Missing PR number.');
    }
    const eventHead = context.payload.pull_request?.head?.sha;
    try {
      const { data: pr } = await github.rest.pulls.get({ ...context.repo, pull_number: number });
      pulls = [pr];
      // Also refresh an earlier head if this event queued while the head changed.
      if (eventHead && eventHead !== pr.head.sha) {
        pulls.push({ number, head: { sha: eventHead } });
      }
    } catch (error) {
      if (!eventHead) {
        throw error;
      }
      // The worker can still invalidate an old success and retry against current API state.
      pulls = [{ number, head: { sha: eventHead } }];
    }
  } else {
    if (context.eventName === 'push' && context.payload.ref !== `refs/heads/${baseBranch}`) {
      return [];
    }
    if (context.eventName !== 'push' && context.eventName !== 'workflow_dispatch') {
      throw new Error(`Unsupported event: ${context.eventName}`);
    }
    const open = await github.paginate(github.rest.pulls.list, {
      ...context.repo,
      state: 'open',
      base: baseBranch,
      per_page: 100,
    });
    pulls = open.filter(
      (pr) =>
        context.eventName === 'workflow_dispatch' ||
        pr.labels.some((label) => label.name === releaseLabel),
    );
  }

  // A fixed number of buckets stays below GitHub's 256-job matrix limit.
  /** @type {Map<number, Batch>} */
  const batches = new Map();
  for (const pr of pulls) {
    const bucket = bucketFor(pr.head.sha);
    const batch = batches.get(bucket) ?? { bucket, pulls: [] };
    batch.pulls.push({ number: pr.number, sha: pr.head.sha });
    batches.set(bucket, batch);
  }
  return [...batches.values()];
}

/** @param {Options & { batch: Batch }} options */
async function checkPullRequestBatch({
  github,
  context,
  batch,
  baseBranch = 'master',
  releaseLabel = 'release',
}) {
  /** @param {string} sha @param {'pending' | 'success' | 'failure' | 'error'} state @param {string} description */
  const report = (sha, state, description) =>
    github.rest.repos.createCommitStatus({
      ...context.repo,
      sha,
      context: 'Release branch up to date',
      state,
      description: description.slice(0, 140),
      target_url: `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`,
    });
  const preparedHeads = new Set(batch.pulls.map((pr) => pr.sha));

  /** @param {string} sha */
  const getCurrentStatus = async (sha) => {
    const { data: statuses } = await github.rest.repos.listCommitStatusesForRef({
      ...context.repo,
      ref: sha,
      per_page: 100,
    });
    return statuses.find((status) => status.context === 'Release branch up to date');
  };

  /** @param {string} sha @param {'success' | 'failure' | 'error'} state @param {string} description @param {Awaited<ReturnType<typeof getCurrentStatus>>} currentStatus */
  const reportIfChanged = async (sha, state, description, currentStatus) => {
    if (currentStatus?.state === state && currentStatus.description === description) {
      return;
    }
    await report(sha, state, description);
  };

  /** @type {Awaited<ReturnType<typeof github.rest.pulls.list>>['data']} */
  let open;
  try {
    open = await github.paginate(github.rest.pulls.list, {
      ...context.repo,
      state: 'open',
      base: baseBranch,
      per_page: 100,
    });
  } catch (error) {
    for (const sha of preparedHeads) {
      const currentStatus = await getCurrentStatus(sha);
      await reportIfChanged(
        sha,
        'error',
        'Unable to fetch PRs. Re-run the release freshness workflow.',
        currentStatus,
      );
    }
    throw error;
  }

  // Statuses are shared by PRs with the same SHA. Any release PR sharing the head
  // must satisfy freshness, so an unlabeled PR cannot overwrite its failure.
  const heads = new Map([...preparedHeads].map((sha) => [sha, false]));
  for (const pr of open) {
    if (bucketFor(pr.head.sha) !== batch.bucket) {
      continue;
    }
    heads.set(
      pr.head.sha,
      heads.get(pr.head.sha) === true || pr.labels.some((label) => label.name === releaseLabel),
    );
  }

  const errors = [];
  for (const [sha, release] of heads) {
    let currentStatus;
    try {
      currentStatus = await getCurrentStatus(sha);
    } catch (error) {
      try {
        await report(
          sha,
          'error',
          'Unable to read the current status. Re-run the release freshness workflow.',
        );
      } catch (statusError) {
        errors.push(statusError);
        continue;
      }
      errors.push(error);
      continue;
    }
    try {
      if (!release) {
        await reportIfChanged(
          sha,
          'success',
          'No open release PR targets this branch with this head commit.',
          currentStatus,
        );
        continue;
      }
      // Resolve the live base branch, rather than using an older push payload.
      try {
        const { data: comparison } = await github.rest.repos.compareCommitsWithBasehead({
          ...context.repo,
          basehead: `${baseBranch}...${sha}`,
          per_page: 1,
        });
        const upToDate = comparison.behind_by === 0;
        await reportIfChanged(
          sha,
          upToDate ? 'success' : 'failure',
          upToDate
            ? `This release PR contains the latest ${baseBranch} commits.`
            : `Merge or rebase ${baseBranch} into this release PR.`,
          currentStatus,
        );
      } catch (error) {
        await reportIfChanged(
          sha,
          'error',
          'Unable to compare commits. Re-run the release freshness workflow.',
          currentStatus,
        );
        errors.push(error);
      }
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Some release branch freshness checks failed.');
  }
}

module.exports = { getPullRequests, checkPullRequestBatch };
