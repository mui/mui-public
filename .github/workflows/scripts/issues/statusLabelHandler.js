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

    core.debug(`>>> Context: ${JSON.stringify(context)}`);

    const issue = await github.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });

    core.debug(`>>> Issue data: ${JSON.stringify(issue.data)}`);

    const issueAuthor = issue.data.user?.login;
    core.info(`>>> Issue author: ${issueAuthor}`);

    // there is no comment when the issue gets closed, so we just assign null and continue with the action
    const commentAuthor = context.payload.comment?.user.login;
    core.info(`>>> Comment author: ${commentAuthor}`);

    // return early if the author of the comment is not the same as the author of the issue
    if (issueAuthor !== commentAuthor) {
      core.info('>>> Comment is not from the issue author. Exiting.');
      return;
    }

    const labels = issue.data.labels.map((label) => label.name);
    core.debug(`>>> Issue labels: ${JSON.stringify(labels)}`);

    const maintainerLabel = 'status: waiting for maintainer';
    const authorLabel = 'status: waiting for author';

    // no need to update when the label is already present on the issue
    if (labels.includes(maintainerLabel)) {
      core.info(`>>> '${maintainerLabel}' label already present. Exiting.`);
      return;
    }

    // if we are not waiting for author feedback, we can exit
    if (!labels.includes(authorLabel)) {
      core.info(`>>> '${authorLabel}' label not present. Exiting.`);
      return;
    }

    // remove maintainerLabel and authorLabel from labels
    const purgedLabels = labels.filter(
      (label) => label !== maintainerLabel && label !== authorLabel,
    );
    core.info(`>>> Purged labels: ${JSON.stringify(purgedLabels)}`);

    // check if the issue is closed or gets closed with this event
    const issueIsOrGetsClosed =
      context.payload.action === 'closed' || issue.data.state === 'closed';
    core.info(`>>> Issue is or gets closed: ${issueIsOrGetsClosed}`);

    // add maintainerLabel when issue is not/won't be closed
    const labelsForUpdate = issueIsOrGetsClosed ? purgedLabels : [...purgedLabels, maintainerLabel];

    core.info(`>>> Updating issue with new labels`);
    await github.rest.issues.update({
      owner,
      repo,
      issue_number: issueNumber,
      labels: labelsForUpdate,
    });
  } catch (error) {
    core.error(`>>> Workflow failed with: ${error.message}`);
    core.setFailed(error.message);
  }
};
