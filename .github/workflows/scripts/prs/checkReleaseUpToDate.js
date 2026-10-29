// @ts-check
/* eslint-disable no-await-in-loop -- Serialize GitHub requests to preserve status ordering and avoid secondary rate limits. */

/**
 * @typedef {Object} Options
 * @property {ReturnType<typeof import('@actions/github').getOctokit>} github
 * @property {typeof import('@actions/github').context} context
 * @property {string} [baseBranch]
 * @property {string} [releaseLabel]
 */

/** @param {Options} options */
async function checkReleaseUpToDate({
  github,
  context,
  baseBranch = 'master',
  releaseLabel = 'release',
}) {
  if (context.eventName === 'push' && context.payload.ref !== `refs/heads/${baseBranch}`) {
    return;
  }
  if (
    !['pull_request_target', 'push', 'workflow_dispatch', 'schedule'].includes(context.eventName)
  ) {
    throw new Error(`Unsupported event: ${context.eventName}`);
  }

  const statusContext = 'Release branch up to date';
  /** @param {string} sha @param {'success' | 'failure' | 'error'} state @param {string} description */
  const report = (sha, state, description) =>
    github.rest.repos.createCommitStatus({
      ...context.repo,
      sha,
      context: statusContext,
      state,
      description,
      target_url: `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`,
    });

  // Include event heads to clear a closed, retargeted, or synchronized PR's old
  // status even when no open PR uses that head anymore.
  /** @type {Map<string, boolean>} */
  const heads = new Map();
  if (context.eventName === 'pull_request_target') {
    for (const sha of [context.payload.pull_request?.head?.sha, context.payload.before]) {
      if (typeof sha === 'string' && /^[a-f\d]{40}$/i.test(sha)) {
        heads.set(sha, false);
      }
    }
  }

  try {
    // Reconcile all open heads on every run. GitHub can replace a pending job;
    // the replacement must also repair the PR that triggered the discarded job.
    for await (const { data: pulls } of github.paginate.iterator(github.rest.pulls.list, {
      ...context.repo,
      state: 'open',
      base: baseBranch,
      per_page: 100,
    })) {
      for (const pr of pulls) {
        // Commit statuses are SHA-scoped: any release PR sharing this head must
        // satisfy freshness, regardless of which PR triggered the workflow.
        heads.set(
          pr.head.sha,
          heads.get(pr.head.sha) === true || pr.labels.some((label) => label.name === releaseLabel),
        );
      }
    }
  } catch (error) {
    const errors = [error];
    // Discovery may fail on a later page. Invalidate every head learned so far,
    // without depending on another read, and do not stop at the first failed write.
    for (const sha of heads.keys()) {
      try {
        await report(sha, 'error', 'Unable to fetch PRs. Re-run the release freshness workflow.');
      } catch (statusError) {
        errors.push(statusError);
      }
    }
    throw new AggregateError(errors, 'Unable to fetch PRs for release freshness.');
  }

  /** @typedef {{ state: string, description: string | null }} Status */
  /** @type {Map<string, Status | null | undefined>} */
  const currentStatuses = new Map();
  const shas = [...heads.keys()];
  for (let offset = 0; offset < shas.length; offset += 50) {
    const chunk = shas.slice(offset, offset + 50);
    // Read only this context, in batches, rather than spending one REST request
    // per open PR or walking unrelated status history.
    const fields = chunk
      .map(
        (sha, index) =>
          `head${index}: object(oid: "${sha}") { ... on Commit { status { context(name: $context) { state description } } } }`,
      )
      .join('\n');
    try {
      const result = await github.graphql(
        `query($owner: String!, $repo: String!, $context: String!) {
          repository(owner: $owner, name: $repo) { ${fields} }
        }`,
        { ...context.repo, context: statusContext },
      );
      /** @type {{ repository: Record<string, { status: { context: Status | null } | null } | null> | null }} */
      const data = result;
      chunk.forEach((sha, index) => {
        currentStatuses.set(sha, data.repository?.[`head${index}`]?.status?.context);
      });
    } catch {
      // This read only saves writes. Still publish computed results on failure.
    }
  }

  const errors = [];
  for (const [sha, release] of heads) {
    /** @type {'success' | 'failure' | 'error'} */
    let state = 'success';
    let description = 'No open release PR targets this branch with this head commit.';
    if (release) {
      try {
        // Resolve the live base branch, rather than using an older push payload.
        const { data: comparison } = await github.rest.repos.compareCommitsWithBasehead({
          ...context.repo,
          basehead: `${baseBranch}...${sha}`,
          per_page: 1,
        });
        state = comparison.behind_by === 0 ? 'success' : 'failure';
        description =
          state === 'success'
            ? `This release PR contains the latest ${baseBranch} commits.`
            : `Merge or rebase ${baseBranch} into this release PR.`;
      } catch (error) {
        state = 'error';
        description = 'Unable to compare commits. Re-run the release freshness workflow.';
        errors.push(error);
      }
    }

    description = description.slice(0, 140);
    try {
      // Status history is only a write-deduplication optimization. Failure to read
      // it must never prevent publishing the result established above.
      const currentStatus = currentStatuses.get(sha);
      if (
        currentStatus?.state.toLowerCase() !== state ||
        currentStatus.description !== description
      ) {
        await report(sha, state, description);
      }
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Some release branch freshness checks failed.');
  }
}

module.exports = { checkReleaseUpToDate };
