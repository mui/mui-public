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

    const repositoryMap = {
      'mui-x': 'x',
      'mui-toolpad': 'toolpad',
      'material-ui': 'material-ui',
      'base-ui': 'base-ui',
      'pigment-css': 'pigment-css',
      'joy-ui': 'joy-ui',
    };

    const commentLines = [
      `**This issue has been closed.** If you have a similar problem but not exactly the same, please open a [new issue](https://github.com/mui/${repo}/issues/new/choose).`,
      'Now, if you have additional information related to this issue or things that could help future readers, feel free to leave a comment.',
    ];

    const userPermission = await github.rest.repos.getCollaboratorPermissionLevel({
      owner,
      repo,
      username: issue.data.user.login,
    });

    core.info(`>>> Author permission level: ${userPermission.data.permission}`);

    // Only ask for feedback if the user is not an admin or has at least write access (from a team membership)
    if (!['admin', 'write'].includes(userPermission.data.permission)) {
      commentLines.push('> [!NOTE]');
      commentLines.push(
        `> @${issue.data.user.login} How did we do? Your experience with our support team matters to us. If you have a moment, please share your thoughts in this short [Support Satisfaction survey](https://tally.mui.com/support-satisfaction-survey?issue=${issueNumber}&productId=${repositoryMap[repo]}).`,
      );
    }

    const body = commentLines.join('\n');
    core.info(`>>> Prepared comment body: ${body}`);

    await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });

    try {
      const labelName = 'status: waiting for maintainer';
      core.info(`>>> Trying to remove label: ${labelName}`);

      await github.rest.issues.removeLabel({
        owner,
        repo,
        issue_number: issueNumber,
        name: labelName,
      });
    } catch (error) {
      // intentionally not failing this job, since the label might not exist
      core.error(`>>> Failed to remove label: ${error.message}`);
    }
  } catch (error) {
    core.error(`>>> Workflow failed with: ${error.message}`);
    core.setFailed(error.message);
  }
};
