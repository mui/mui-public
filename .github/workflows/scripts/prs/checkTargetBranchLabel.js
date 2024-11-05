// @ts-check
const vBranchRegex = /^v\d{1,3}\.x$/;
const transferLabels = ['cherry-pick'];

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

    const pr = await github.rest.pull_request.get({
      owner,
      repo,
      pull_number: pullNumber,
    });

    core.info(`>>> PR fetched: ${pr.id}`);

    const targetLabels = pr.labels
      .map((label) => label.name)
      .filter((label) => vBranchRegex.test(label));

    const comesFromVersionBranch = vBranchRegex.test(pr.head_ref);
    const commentLines = [
      '> [!NOTE]',
      '> Thanks for tagging this PR with the "needs cherry-pick" label.',
    ];

    if (targetLabels.length > 0) {
      core.info(`>>> Target labels found: ${targetLabels.join(', ')}`);
      core.info('>>> No need for a comment! 👍');
      return;
    }

    // there was no target branch present
    core.info('>>> No target branch label found');
    commentLines.push('> This PR does not have a target branch label. (e.g. `v7.x`)');
    if (comesFromVersionBranch) {
      commentLines.push(
        '> Since this PR is coming from a version branch, the default target branch is `master`.',
      );
      commentLines.push(
        '> If this PR should be cherry-picked to a different branch, please add the appropriate label.',
      );
    } else {
      commentLines.push(
        '> Please add the appropriate label to ensure the PR gets cherry-picked to the correct branch.',
      );
    }
    commentLines.push('> Thanks! 🙏');

    core.info(`>>> Creating explanatory comment on PR`);
    await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body: commentLines.join('\n\n'),
    });
  } catch (error) {
    core.error(`>>> Workflow failed with: ${error.message}`);
    core.setFailed(error.message);
  }
};
