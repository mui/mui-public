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

const typeLabels = ['bug', 'regression', 'maintenance', 'enhancement', 'new feature'];
const labelRegex = new RegExp(`\\b(${typeLabels.join('|')})\\b`, 'i');

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

    const commentLines = [];

    if (typeLabelsFound.length === 0) {
      core.info(`>>> No type labels found`);

      // Add a comment line explaining that a type label needs to be added
      commentLines.push(
        'Please add one type label to categorize the purpose of this PR appropriately:',
      );
      commentLines.push(createEnumerationFromArray(typeLabels));
    } else if (typeLabelsFound.length > 1) {
      core.info(`>>> Multiple type labels found: ${typeLabelsFound.join(', ')}`);

      // add a comment line explaining that only one type label is allowed
      commentLines.push(`Multiple type labels found: ${typeLabelsFound.join(', ')}`);
      commentLines.push(
        'Only one is allowed. Please remove the extra type labels to ensure the PR is categorized correctly.',
      );
    } else {
      core.info(`>>> Single type label found: ${typeLabelsFound[0]}`);
      core.info(`>>> Exiting gracefully! 👍`);
      return;
    }

    core.info(`>>> Creating explanatory comment on PR`);
    await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body: commentLines.join('\n\n'),
    });
    core.setFailed('>>> Failing workflow to prevent merge without passing this!');
  } catch (error) {
    core.error(`>>> Workflow failed with: ${error.message}`);
    core.setFailed(error.message);
  }
};
