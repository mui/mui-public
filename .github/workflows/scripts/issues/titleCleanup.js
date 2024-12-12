// @ts-check
const regexes = {
  // covers 'dataGrid' in all variants, as well as with suffixes (-pro/-premium/etc)
  dataGrid: /\s?\[\s?(data\s?grid[-\sA-Za-z]*)]/gi,
  // covers 'charts' in all variants, as well as with prefixes (PieChart, LineChart, etc)
  charts: /\s?\[\s?([-\sA-Za-z]*charts?)]/gi,
  // covers 'pickers' in all variants, as well as with prefixes (DatePicker, time-picker, etc)
  pickers: /\s?\[\s?([-\sA-Za-z]*pickers?)]/gi,
  // covers 'treeView' in all variants
  treeView: /\s?\[\s?([-\sA-Za-z]*tree\s?(view|item))]/gi,
};

const replacements = {
  dataGrid: 'data grid',
  charts: 'charts',
  pickers: 'pickers',
  treeView: 'tree view',
};

const regex =
  /\[\s*(?:(?<dataGrid>data\s?grid.*)|(?<charts>.*charts?)|(?<pickers>.*pickers?)|(?<treeView>tree\s?(view|item)))\s*]/gi;

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

    core.info(`>>> Original title: ${issue.data.title}`);

    let result = issue.data.title;

    // Replace each capture group using its specific regex
    for (const [key, regex] of Object.entries(regexes)) {
      const replacement = replacements[key]; // Get the replacement for the current group
      result = result.replace(regex, `[${replacement}]`); // Replace all matches for this group
    }

    core.info(`>>> Updated title: ${result}`);

    await github.rest.issues.update({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: context.issue.number,
      title: result,
    });
  } catch (error) {
    core.error(`>>> Workflow failed with: ${error.message}`);
    core.setFailed(error.message);
  }
};
