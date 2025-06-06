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
  'type: release',
  'type: bug',
  'type: regression',
  'type: enhancement',
  'type: new feature',
  'type: internal',
  // only used by renovate bot so we can ignore the "type: " prefix here
  'dependencies',
];
const labelRegex = new RegExp(`\\b(${typeLabels.join('|')})\\b`, 'i');

const NO_LABELS_COMMENT =
  'Please add one type label to categorize the purpose of this PR appropriately:';
const MULTIPLE_LABELS_COMMENT = 'Multiple type labels found:';

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

    if (typeLabelsFound.length === 0) {
      core.info(`>>> No type labels found`);
      core.setFailed(`>>> ${NO_LABELS_COMMENT} ${createEnumerationFromArray(typeLabels)}`);
      return;
    }

    if (typeLabelsFound.length > 1) {
      core.info(`>>> Multiple type labels found: ${typeLabelsFound.join(', ')}`);
      core.setFailed(`>>> ${MULTIPLE_LABELS_COMMENT} ${typeLabelsFound.join(', ')}`);
      return;
    }

    core.info(`>>> Single type label found: ${typeLabelsFound[0]}`);
  } catch (error) {
    core.error(`>>> Workflow failed with: ${error.message}`);
    core.setFailed(error.message);
  }
};
