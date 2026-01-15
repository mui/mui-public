// @ts-check
const vLabelRegex = /^v\d+\.x$/;

const NO_VERSION_LABEL_COMMENT =
  'Please add a version label to categorize which major version this PR targets:';

/**
 * @param {Object} params
 * @param {import("@actions/core")} params.core
 * @param {ReturnType<import("@actions/github").getOctokit>} params.github
 * @param {import("@actions/github").context} params.context
 */
module.exports = async ({ core, context, github }) => {
  try {
    const mainVersionLabel = process.env.MAIN_VERSION_LABEL || '';

    const owner = context.repo.owner;
    const repo = context.repo.repo;
    const pullNumber = context.issue.number;

    const { data: pr } = await github.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });

    core.info(`>>> PR fetched: ${pr.number}`);
    core.info(`>>> PR base branch: ${pr.base.ref}`);
    core.info(`>>> Main version label configured: ${mainVersionLabel}`);

    const versionLabels = pr.labels
      ?.map((label) => label.name)
      .filter((labelName) => vLabelRegex.test(labelName));

    if (versionLabels.length === 0) {
      core.info(`>>> No version labels found`);
      const exampleLabels = mainVersionLabel
        ? [mainVersionLabel, 'v8.x', 'v7.x']
        : ['v8.x', 'v7.x'];
      // Dedupe in case mainVersionLabel is one of the examples
      const uniqueExamples = [...new Set(exampleLabels)];
      core.setFailed(`>>> ${NO_VERSION_LABEL_COMMENT} ${uniqueExamples.join(', ')}`);
      return;
    }

    core.info(`>>> Version labels found: ${versionLabels.join(', ')}`);

    // Determine if we need to trigger cherry-pick
    // Cherry-pick is needed when:
    // 1. PR is targeting the default branch and has version labels OTHER than the main version label
    // 2. PR is targeting a version branch and has version labels OTHER than that branch's label
    const defaultBranch = context.payload.repository?.default_branch || 'master';
    const baseBranch = pr.base.ref;
    const isOnDefaultBranch = baseBranch === defaultBranch;
    const isOnVersionBranch = vLabelRegex.test(baseBranch);

    core.info(`>>> Base branch: ${baseBranch}`);
    core.info(`>>> Is on default branch: ${isOnDefaultBranch}`);
    core.info(`>>> Is on version branch: ${isOnVersionBranch}`);

    // Determine the "current" version label for this branch
    // - If on default branch, it's the mainVersionLabel
    // - If on a version branch (e.g., v8.x), it's the branch name itself
    let currentBranchLabel = '';
    if (isOnDefaultBranch) {
      currentBranchLabel = mainVersionLabel;
    } else if (isOnVersionBranch) {
      currentBranchLabel = baseBranch;
    }

    core.info(`>>> Current branch label: ${currentBranchLabel || '(none)'}`);

    if (currentBranchLabel) {
      // Filter out the current branch's label to find cherry-pick targets
      const cherryPickTargets = versionLabels.filter((label) => label !== currentBranchLabel);

      if (cherryPickTargets.length > 0) {
        core.info(`>>> PR has version labels for other branches`);
        core.info(`>>> Cherry-pick targets: ${cherryPickTargets.join(', ')}`);
        core.setOutput('NEEDS_CHERRY_PICK', 'true');
        core.setOutput('CHERRY_PICK_TARGETS', JSON.stringify(cherryPickTargets));
      } else {
        core.info(`>>> PR only has the current branch's version label, no cherry-pick needed`);
        core.setOutput('NEEDS_CHERRY_PICK', 'false');
        core.setOutput('CHERRY_PICK_TARGETS', '[]');
      }
    } else {
      core.info(
        `>>> PR is not on default branch or a version branch, no cherry-pick logic applies`,
      );
      core.setOutput('NEEDS_CHERRY_PICK', 'false');
      core.setOutput('CHERRY_PICK_TARGETS', '[]');
    }

    core.info(`>>> Version label check passed`);
  } catch (error) {
    if (error instanceof Error) {
      core.error(error);
      core.setFailed(error);
    } else {
      core.error(`>>> Workflow failed with unknown error`);
      core.error(`${error}`);
      core.setFailed('An unknown error occurred');
    }
  }
};
