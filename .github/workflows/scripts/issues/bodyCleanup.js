// @ts-check

function extractInputSection(lines, title) {
  const index = lines.findIndex((line) => line.startsWith('###') && line.includes(title));
  if (index === -1) {
    return '';
  }
  return lines.splice(index, 4)[2].trim();
}

const productMap = {
  'Data Grid': 'data grid',
  'Date and Time Pickers': 'pickers',
  Charts: 'charts',
  'Tree View': 'tree view',
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
    const issueNumber = context.issue.number;

    const issue = await github.rest.issues.get({
      owner,
      repo,
      issue_number: issueNumber,
    });

    const lines = issue.data.body.split('\n');

    // this is here to remove this section from the issue body
    extractInputSection(lines, 'Latest version');

    const searchKeywords = extractInputSection(lines, 'Search keywords');
    const products = extractInputSection(lines, 'Affected products');

    // get the order id and set it as an output for the support label step
    let orderID = extractInputSection(lines, 'Order ID or Support key');
    if (orderID === '_No response_') {
      orderID = '';
    }

    // set the order id as an output (to be consumed by following workflows)
    core.setOutput('ORDER_ID', orderID);

    // log all the values
    core.info(`>>> Search Keywords: ${searchKeywords}`);
    core.info(`>>> Order ID: ${orderID}`);
    core.info(`>>> Affected Products: ${products}`);

    if (searchKeywords !== '') {
      lines.push('');
      lines.push(`**Search keywords**: ${searchKeywords}`);
    }

    if (orderID !== '') {
      lines.push('');
      lines.push(`**Order ID**: ${orderID}`);
    }

    const body = lines.join('\n');
    core.info(`>>> Cleansed issue body: ${body}`);

    const labels = issue.data.labels.map((label) => label.name);

    if (products !== '') {
      products.split(',').forEach((product) => {
        if (productMap[product.trim()]) {
          labels.push(`component: ${productMap[product.trim()]}`);
        }
      });
    }

    core.info(`>>> Labels: ${labels.join(',')}`);

    await github.rest.issues.update({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: context.issue.number,
      title: issue.data.title,
      body,
      labels,
    });
  } catch (error) {
    core.error(`>>> Workflow failed with: ${error.message}`);
    core.setFailed(error.message);
  }
};
