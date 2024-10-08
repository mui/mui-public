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

    const orderId = process.env.ORDER_ID;
    const orderApiToken = process.env.ORDER_API_TOKEN;

    const orderApi = 'https://store-wp.mui.com/wp-json/wc/v3/orders/';

    core.info(`>>> Order ID: ${orderId}`);

    if (!orderId) {
      core.info('No Order ID');
    } else {
      const order = await fetch(`${orderApi}${orderId}`, {
        headers: {
          Authorization: `Basic ${orderApiToken}`,
          'User-Agent': 'MUI-Tools-Private/X-Orders-Inspector v1',
        },
      });

      if (!order.ok) {
        core.info(`Request to ${orderApi} failed. Response status code: ${order.status}.`);
      }

      const orderDetails = await order.json();

      core.info(`>>> Order Items: ${orderDetails.line_items?.join(',')}`);

      const plan =
        orderDetails.line_items?.filter((item) => /\b(pro|premium)\b/i.test(item.name))[0].name ||
        '';

      if (!plan) {
        core.info('No Pro or Premium plan found in order');
        return;
      }

      const planName = plan.match(/\b(pro|premium)\b/i)[0].toLowerCase();

      if (planName !== 'pro' && planName !== 'premium') {
        core.info(`>>> planName: ${planName}`);
        core.info('planName could not be extracted');
        return;
      }

      const labelName = `support: ${planName} standard`;

      core.info(`>>> planName: ${planName}`);
      core.info(`>>> labelName: ${labelName}`);

      await github.rest.issues.addLabels({
        owner,
        repo,
        issue_number: issueNumber,
        labels: [labelName],
      });
    }
  } catch (error) {
    core.error(`>>> Workflow failed with: ${error.message}`);
    core.setFailed(error.message);
  }
};
