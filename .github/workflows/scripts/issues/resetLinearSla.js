// @ts-check

// Labels that identify pro/premium customer issues.
// Extend if needed (e.g. 'support: priority', 'support: commercial').
const PAID_SUPPORT_LABELS = ['support: pro standard', 'support: premium standard'];

// Commenters that count as "team": org members/owners/repo collaborators,
// plus the Linear sync bot (comments written in Linear and synced to GitHub).
const TEAM_ASSOCIATIONS = ['OWNER', 'MEMBER', 'COLLABORATOR'];
const LINEAR_BOT_LOGIN = 'linear[bot]';

/**
 * @typedef {{ info(message: string): void, error(message: string): void, setFailed(message: string): void }} ActionsCore
 * @typedef {{ name?: string }} GitHubLabel
 * @typedef {{ number: number, html_url: string, labels: Array<GitHubLabel | string> }} GitHubIssue
 * @typedef {{ author_association?: string, user?: { login?: string } | null }} GitHubComment
 * @typedef {{ payload: { issue?: GitHubIssue, comment?: GitHubComment } }} GitHubContext
 * @typedef {{ core: ActionsCore, context: GitHubContext }} ActionParams
 *
 * @typedef {{
 *   id: string,
 *   identifier: string,
 *   createdAt: string,
 *   slaStartedAt?: string | null,
 *   slaBreachesAt?: string | null,
 *   slaType?: string | null,
 *   state?: { type?: string | null } | null,
 * }} LinearIssue
 * @typedef {{ issue?: LinearIssue | null }} LinearAttachmentNode
 * @typedef {{ attachmentsForURL?: { nodes?: LinearAttachmentNode[] | null } | null }} AttachmentsForURLResponse
 * @typedef {{ issueUpdate?: { success?: boolean } | null }} IssueUpdateResponse
 */

/**
 * @template T
 * @param {string} query
 * @param {Record<string, unknown>} variables
 * @returns {Promise<T>}
 */
async function callLinear(query, variables) {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    throw new Error('LINEAR_API_KEY is not set.');
  }

  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  /** @type {{ data?: T, errors?: unknown }} */
  let json;
  try {
    json = await response.json();
  } catch {
    throw new Error(`Linear API returned invalid JSON with status ${response.status}.`);
  }

  if (!response.ok) {
    throw new Error(
      `Linear API request failed with status ${response.status}: ${JSON.stringify(json)}`,
    );
  }
  if (json.errors) {
    throw new Error(`Linear API error: ${JSON.stringify(json.errors)}`);
  }
  if (!json.data) {
    throw new Error(`Linear API response did not include data: ${JSON.stringify(json)}`);
  }
  return json.data;
}

/**
 * @param {unknown} error
 */
function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {string} value
 * @param {string} fieldName
 */
function parseLinearDate(value, fieldName) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Linear issue has an invalid ${fieldName}: ${value}`);
  }

  return date;
}

/**
 * @param {ActionParams} params
 */
module.exports = async ({ core, context }) => {
  try {
    const { issue, comment } = context.payload;
    const dryRun = process.env.DRY_RUN === 'true';

    if (!issue || !comment) {
      core.info('>>> Skipping: expected an issue_comment payload');
      return;
    }

    const labels = issue.labels
      .map((label) => (typeof label === 'string' ? label : label.name))
      .filter((labelName) => typeof labelName === 'string');

    if (!labels.some((name) => PAID_SUPPORT_LABELS.includes(name))) {
      core.info(
        `>>> Skipping: no paid-support label on #${issue.number} (labels: ${labels.join(', ')})`,
      );
      return;
    }

    const commenterLogin = comment.user?.login;
    if (!commenterLogin) {
      core.info('>>> Skipping: comment has no user login');
      return;
    }

    const isTeamMember = TEAM_ASSOCIATIONS.includes(comment.author_association ?? '');
    const isLinearBot = commenterLogin === LINEAR_BOT_LOGIN;
    if (!isTeamMember && !isLinearBot) {
      core.info(
        `>>> Skipping: commenter ${commenterLogin} (${comment.author_association ?? 'unknown'}) is not a team member`,
      );
      return;
    }

    /** @type {AttachmentsForURLResponse} */
    const data = await callLinear(
      `query ($url: String!) {
        attachmentsForURL(url: $url) {
          nodes {
            issue {
              id
              identifier
              createdAt
              slaStartedAt
              slaBreachesAt
              slaType
              state { type }
            }
          }
        }
      }`,
      { url: issue.html_url },
    );

    const linearIssue = data.attachmentsForURL?.nodes?.find((node) => node.issue)?.issue;
    if (!linearIssue) {
      core.info(`>>> Skipping: no Linear issue linked to ${issue.html_url}`);
      return;
    }
    core.info(`>>> Found linked Linear issue: ${linearIssue.identifier}`);

    const stateType = linearIssue.state?.type;
    if (stateType && ['completed', 'canceled'].includes(stateType)) {
      core.info(`>>> Skipping: ${linearIssue.identifier} is ${stateType}`);
      return;
    }
    if (!linearIssue.slaBreachesAt) {
      core.info(`>>> Skipping: ${linearIssue.identifier} has no active SLA`);
      return;
    }

    // Keep the original SLA duration, restart the clock from now
    const startedAt = parseLinearDate(
      linearIssue.slaStartedAt ?? linearIssue.createdAt,
      'slaStartedAt',
    );
    const breachesAt = parseLinearDate(linearIssue.slaBreachesAt, 'slaBreachesAt');
    const durationMs = breachesAt.getTime() - startedAt.getTime();
    if (durationMs <= 0) {
      core.info(`>>> Skipping: ${linearIssue.identifier} has a non-positive SLA duration`);
      return;
    }

    const now = new Date();
    const newBreachesAt = new Date(now.getTime() + durationMs);

    core.info(
      `>>> Resetting SLA on ${linearIssue.identifier}: duration ${Math.round(durationMs / 3600000)}h, ` +
        `new breach time ${newBreachesAt.toISOString()}, triggered by ${commenterLogin}`,
    );

    if (dryRun) {
      core.info('>>> DRY_RUN is set, skipping the mutation');
      return;
    }

    /** @type {IssueUpdateResponse} */
    const update = await callLinear(
      `mutation ($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) { success }
      }`,
      {
        id: linearIssue.id,
        input: {
          slaStartedAt: now.toISOString(),
          slaBreachesAt: newBreachesAt.toISOString(),
          slaType: linearIssue.slaType ?? 'all',
        },
      },
    );

    if (!update.issueUpdate?.success) {
      throw new Error(`Linear API did not confirm SLA reset on ${linearIssue.identifier}`);
    }

    core.info(`>>> SLA reset on ${linearIssue.identifier}`);
  } catch (error) {
    const message = getErrorMessage(error);
    core.error(`>>> Workflow failed with: ${message}`);
    core.setFailed(message);
  }
};
