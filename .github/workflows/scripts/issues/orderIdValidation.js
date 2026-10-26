// @ts-check
/**
 * @param {Object} params
 * @param {typeof import("@actions/core")} params.core
 * @param {ReturnType<typeof import("@actions/github").getOctokit>} params.github
 * @param {typeof import("@actions/github").context} params.context
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

      /** @type {{ line_items?: { name: string }[] }} */
      const orderDetails = await order.json();

      core.info(`>>> Order Items: ${orderDetails.line_items?.join(',')}`);

      // An order can contain both plans. Item order must not determine support priority.
      const planName = ['premium', 'pro'].find((plan) =>
        orderDetails.line_items?.some((item) => new RegExp(`\\b${plan}\\b`, 'i').test(item.name)),
      );

      if (!planName) {
        core.info('No Pro or Premium plan found in order');
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
    const message = error instanceof Error ? error.message : String(error);
    core.error(`>>> Workflow failed with: ${message}`);
    core.setFailed(message);
  }
};
