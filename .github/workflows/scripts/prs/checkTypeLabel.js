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

const typeLabels = ['release', 'bug', 'regression', 'dependencies', 'enhancement', 'new feature'];
const labelRegex = new RegExp(`\\b(${typeLabels.join('|')})\\b`, 'i');

const NO_LABELS_COMMENT =
  'Please add one type label to categorize the purpose of this PR appropriately:';
const MULTIPLE_LABELS_COMMENT = 'Multiple type labels found:';

/**
 * @param {Awaited<ReturnType<ReturnType<import("@actions/github").getOctokit>['rest']['issues']['listComments']>>['data']} comments
 */
function containsAny(comments) {
  return (
    comments.find(
      (comment) =>
        comment.body?.startsWith(NO_LABELS_COMMENT) ||
        comment.body?.startsWith(MULTIPLE_LABELS_COMMENT),
    ) ?? false
  );
}

/**
 * @param {Object} params
 * @param {import("@actions/core")} params.core
 * @param {ReturnType<import("@actions/github").getOctokit>} params.github
 * @param {import("@actions/github").context} params.context
 * @param {Awaited<ReturnType<ReturnType<import("@actions/github").getOctokit>['rest']['issues']['listComments']>>['data']} params.comments
 */
const createCommentHandler = ({ core, context, github, comments }) => {
  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const pullNumber = context.issue.number;

  const commentFound = containsAny(comments);

  return {
    addComment: async (/** @type {string[]} */ commentLines, removeComment) => {
      if (commentFound) {
        core.info(`>>> Updating existing comment on PR`);
        core.info(`>>> Comment id: ${commentFound.id}`);

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
    },
    removeComment: async () => {
      if (!commentFound) {
        return;
      }

      core.info(`>>> Removing existing comment on PR`);
      core.info(`>>> Comment id: ${commentFound.id}`);

      return await github.rest.issues.deleteComment({
        owner,
        repo,
        comment_id: commentFound.id,
      });
    },
  };
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

    const { addComment, removeComment } = createCommentHandler({
      core,
      context,
      github,
      comments: prComments,
    });

    if (typeLabelsFound.length === 0) {
      core.info(`>>> No type labels found`);

      // Add a comment line explaining that a type label needs to be added
      await addComment([NO_LABELS_COMMENT, createEnumerationFromArray(typeLabels)]);

      core.setFailed('>>> Failing workflow to prevent merge without passing this!');
      return;
    }

    if (typeLabelsFound.length > 1) {
      core.info(`>>> Multiple type labels found: ${typeLabelsFound.join(', ')}`);

      // add a comment line explaining that only one type label is allowed
      await addComment([
        MULTIPLE_LABELS_COMMENT,
        typeLabelsFound.map((label) => `- ${label}`).join('\n'),
        'Only one is allowed. Please remove the extra type labels to ensure the PR is categorized correctly.',
      ]);

      core.setFailed('>>> Failing workflow to prevent merge without passing this!');
      return;
    }

    core.info(`>>> Single type label found: ${typeLabelsFound[0]}`);

    await removeComment();
  } catch (error) {
    core.error(`>>> Workflow failed with: ${error.message}`);
    core.setFailed(error.message);
  }
};
