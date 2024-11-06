// @ts-check
const vBranchRegex = /^v\d{1,3}\.x$/;
const targetBranches = [];

/**
 * @param {Object} params
 * @param {import("@actions/core")} params.core
 * @param {ReturnType<import("@actions/github").getOctokit>} params.github
 * @param {import("@actions/github").context} params.context
 */
module.exports = async ({ core, context, github }) => {
  try {
    const owner = context.repo.owner;
    const repo = context.repo.repo;
    const pullNumber = context.issue.number;

    const { data: pr } = await github.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });

    core.info(`>>> PR fetched: ${pr.number}`);

    // filter the target labels from the original PR
    const targetLabels = pr.labels
      .map((label) => label.name)
      .filter((label) => vBranchRegex.test(label));

    if (targetLabels.length === 0) {
      // there was no target branch present
      core.info('>>> No target label found');

      if (vBranchRegex.test(pr.head_ref)) {
        // the branch this is coming from is a version branch, so the cherry-pick target should be master
        core.info('>>> Head Ref is a version branch, setting `master` as target');
        core.setOutput('TARGET_BRANCHES', 'master');
        return;
      }

      // the PR is not coming from a version branch
      core.setOutput('TARGET_BRANCHES', '');
      return;
    }

    core.info(`>>> Target labels found: ${targetLabels.join(', ')}`);

    // get a list of the original reviewers
    const reviewers = pr.requested_reviewers.map((reviewer) => reviewer.login);
    core.info(`>>> Reviewers from original PR: ${reviewers.join(', ')}`);

    // the others will be removed from the PR
    core.info(`>>> Removing target labels from the original PR`);
    for (const label of targetLabels) {
      await github.rest.issues.removeLabel({
        owner,
        repo,
        issue_number: pullNumber,
        name: label,
      });
    }

    core.info(`>>> Removing "needs cherry-pick" label from the original PR`);
    await github.rest.issues.removeLabel({
      owner,
      repo,
      issue_number: pullNumber,
      name: label,
    });

    core.info(`>>> Creating explanatory comment on PR`);
    await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body: `Cherry-pick PRs will be created targeting branches: ${targetLabels.join(', ')}`,
    });

    // set the target branches as output to be used as an input for the next step
    core.setOutput('TARGET_BRANCHES', targetLabels.join(','));
    core.setOutput('REVIEWERS', reviewers.join(','));
  } catch (error) {
    core.error(`>>> Workflow failed with: ${error.message}`);
    core.setFailed(error.message);
  }
};
