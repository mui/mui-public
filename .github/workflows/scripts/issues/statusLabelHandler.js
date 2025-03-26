// @ts-check

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
    const issueNumber = context.issue.number;

    const issue = await github.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });

    const labels = issue.data.labels.map((label) => label.name);

    const maintainerLabel = 'status: waiting for maintainer';
    const authorLabel = 'status: waiting for author';

    if (context.payload.action === 'closed') {
      core.info('>>> Issue was closed. Removing both labels and exiting.');
      await github.rest.issues.update({
        owner,
        repo,
        issue_number: issueNumber,
        labels: labels.filter((label) => label !== maintainerLabel && label !== authorLabel),
      });
      return;
    }

    const issueAuthor = issue.data.user.login;
    const commentAuthor = context.payload.comment.user.login;

    if (issueAuthor !== commentAuthor) {
      core.info('>>> Comment is not from the issue author. Exiting.');
      return;
    }
    const newLabels = labels.filter((label) => label !== authorLabel);
    newLabels.push(maintainerLabel);

    const updateParams = {
      owner,
      repo,
      issue_number: issueNumber,
      labels: newLabels,
    };

    if (issue.data.state === 'closed') {
      core.info('>>> Reopening the issue');
      updateParams.state = 'open';
    }

    core.info(`>>> Updating issue with new labels and state if necessary`);
    await github.rest.issues.update(updateParams);
  } catch (error) {
    core.error(`>>> Workflow failed with: ${error.message}`);
    core.setFailed(error.message);
  }
};
