// @ts-check
const vBranchRegex = /^v\d{1,3}\.x$/;

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

    if (targetLabels.length === 0) {
      // there was no target branch present
      core.info('>>> No target branch label found');

      if (vBranchRegex.test(pr.head_ref)) {
        // the branch this is coming from is a version branch, so the cherry-pick target should be master
        core.info('>>> Head Ref is a version branch, setting `master` is target');
        core.setOutput('TARGET_BRANCH', 'master');
        return;
      }

      core.setOutput('TARGET_BRANCH', '');
      return;
    }

    core.info(`>>> Target labels found: ${targetLabels.join(', ')}`);
    let target = '';

    // there was a target branch label present
    // filter the highest available target number and remove the others from the PR when present
    if (targetLabels.length > 1) {
      core.info(`>>> Multiple target labels found.`);
      targetLabels.sort((a, b) => {
        const aNum = parseInt(a.match(/\d+/)[0], 10);
        const bNum = parseInt(b.match(/\d+/)[0], 10);
        return bNum - aNum;
      });

      target = targetLabels.shift();

      core.info(`>>> Sorting and setting the highest as 'TARGET_BRANCH' output.`);
      core.setOutput('TARGET_BRANCH', target);

      // the others will be removed from the PR
      core.info(`>>> Removing the other target labels from the PR`);
      for (const label of targetLabels) {
        await github.rest.issues.removeLabel({
          owner,
          repo,
          issue_number: pullNumber,
          name: label,
        });
      }

      core.info(`>>> Creating explanatory comment on PR`);
      await github.rest.issues.createComment({
        owner,
        repo,
        issue_number: pullNumber,
        body: [
          `We only support automatically creating PRs to one version branch. The target branch has been set to \`${target}\`.`,
          `Please create a new PR if you want to target a different version branch.`,
          `Branches that are not being targeted automatically are: ${targetLabels.join(', ')}`,
          `Thank you!`,
        ].join('\n\n'),
      });
      return;
    }

    target = targetLabels[0];
    core.info(`>>> Setting found 'TARGET_BRANCH' output.`);
    core.setOutput('TARGET_BRANCH', target);
  } catch (error) {
    core.error(`>>> Workflow failed with: ${error.message}`);
    core.setFailed(error.message);
  }
};
