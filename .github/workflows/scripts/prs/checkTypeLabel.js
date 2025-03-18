// @ts-check
const createEnumerationFromArray = (stringArray) =>
  stringArray.length > 1
    ? stringArray
        .slice(0, -1)
        .map((s) => `\`${s}\``)
        .join(', ') +
      ' or ' +
      `\`${stringArray.slice(-1)}\``
    : stringArray.map((s) => `\`${s}\``).join('');

const typeLabels = [
  'docs',
  'release',
  'bug',
  'regression',
  'maintenance',
  'dependencies',
  'enhancement',
  'new feature',
];
const labelRegex = new RegExp(`\\b(${typeLabels.join('|')})\\b`, 'i');

function containsAny(str, substrings) {
  return substrings.some((sub) => str?.includes(sub));
}

const COMMENT_STARTS = [
  // no label found
  'Please add one type label to categorize the purpose of this PR appropriately:',
  // multiple labels found
  'Multiple type labels found:',
  // success message
  'Thanks for adding a type label to the PR! 👍',
];

const createCommentHandler =
  ({ core, context, github, comments }) =>
  async (commentLines) => {
    const owner = context.repo.owner;
    const repo = context.repo.repo;
    const pullNumber = context.issue.number;

    const commentFound = containsAny(comments, COMMENT_STARTS);

    if (commentFound) {
      core.info(`>>> Updating existing comment on PR`);
      core.info(`>>> Comment id: ${commentFound.id}`);

      // if the first line is the same as with the
      if (commentFound.body.startsWith(comments[0])) {
        core.info(`>>> PR already has the needed comment.`);
        core.info(`>>> Exiting gracefully! 👍`);
        return;
      }

      return await github.rest.issues.updateComment({
        owner,
        repo,
        comment_id: commentFound.id,
        body: commentLines.join('\n\n'),
      });
    }

    core.info(`>>> Creating explanatory comment on PR`);
    return await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body: commentLines.join('\n\n'),
    });
  };

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

    const typeLabelsFound = pr.labels
      ?.map((label) => label.name)
      .filter((labelName) => labelRegex.test(labelName));

    const { data: prComments } = await github.rest.issues.listComments({
      owner,
      repo,
      issue_number: pullNumber,
      per_page: 100,
    });

    const commentHandler = createCommentHandler({
      core,
      context,
      github,
      comments: prComments,
    });

    // docs label is handled differently
    if (typeLabelsFound.some((l) => l === 'docs')) {
      core.info(`>>> 'docs' type label found`);

      await commentHandler([COMMENT_STARTS[2]]);
      return;
    }

    if (typeLabelsFound.length === 0) {
      core.info(`>>> No type labels found`);

      // Add a comment line explaining that a type label needs to be added
      await commentHandler([COMMENT_STARTS[0], createEnumerationFromArray(typeLabels)]);

      core.setFailed('>>> Failing workflow to prevent merge without passing this!');
      return;
    }

    if (typeLabelsFound.length > 1) {
      core.info(`>>> Multiple type labels found: ${typeLabelsFound.join(', ')}`);

      // add a comment line explaining that only one type label is allowed
      await commentHandler([
        `${COMMENT_STARTS[1]} ${typeLabelsFound.join(', ')}`,
        'Only one is allowed. Please remove the extra type labels to ensure the PR is categorized correctly.',
      ]);

      core.setFailed('>>> Failing workflow to prevent merge without passing this!');
      return;
    }

    core.info(`>>> Single type label found: ${typeLabelsFound[0]}`);

    await commentHandler([COMMENT_STARTS[2]]);
  } catch (error) {
    core.error(`>>> Workflow failed with: ${error.message}`);
    core.setFailed(error.message);
  }
};
