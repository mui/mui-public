import dayjs from 'dayjs';
import type { RowDataPacket } from 'mysql2';
import type { Octokit } from '@octokit/rest';
import { LABEL_SUPPORT_PRIORITY, LABEL_SUPPORT_UNKNOWN } from '../constants';
import { getOctokit } from './github';
import { queryStoreDatabase } from './storeDatabase';

const OWNER = 'mui';

/**
 * The repositories whose issues carry the support labels. The owner is always `mui`, so
 * without this the flow would reach any repository in the org. mui-public holds no real
 * support issues; it is here so the flow can be exercised against a test issue.
 */
export const SUPPORT_VALIDATION_REPOS = new Set(['mui-x', 'material-ui', 'mui-public']);

export interface ValidateSupportResult {
  status: 'success' | 'error';
  message: string;
}

/** A support key as recorded in the store database. */
export interface SupportKeyRecord {
  active: boolean;
  expiresAt: string | Date | null;
}

export interface ValidateSupportParams {
  repo: string;
  issueId: number;
  supportKey: string;
}

const SUPPORT_KEY_QUERY =
  'select count(*) as found, expire_at, expire_at > now() as active from wp3u_x_addons where license_key = ?';

/**
 * Reads the support key lookup's result. Returns `null` when the key is unknown — or
 * somehow matches more than one row, which is not something we can act on.
 */
export function parseSupportKeyRows(rows: RowDataPacket[]): SupportKeyRecord | null {
  const hit = rows[0];
  if (!hit || hit.found !== 1) {
    return null;
  }

  return { active: hit.active === 1, expiresAt: hit.expire_at ?? null };
}

/**
 * Looks a support key up in the store database. Resolves to `null` when the key is
 * unknown, and rejects when the database can't be reached, so that infrastructure
 * failures are never reported to the customer as an invalid key.
 */
async function queryPurchasedSupportKey(supportKey: string): Promise<SupportKeyRecord | null> {
  return queryStoreDatabase(async (connection) => {
    const [rows] = await connection.execute<RowDataPacket[]>(SUPPORT_KEY_QUERY, [supportKey]);
    return parseSupportKeyRows(rows);
  });
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 404;
}

/**
 * Swaps the `support: unknown` label on an issue for `support: priority`. The presence
 * of `support: unknown` is what proves the issue is awaiting validation, so an issue
 * without it is refused.
 */
async function updateSupportLabels(
  octokit: Octokit,
  repo: string,
  issueId: number,
): Promise<ValidateSupportResult> {
  let labels: string[];
  try {
    const { data } = await octokit.issues.listLabelsOnIssue({
      owner: OWNER,
      repo,
      issue_number: issueId,
    });
    labels = data.map((label) => label.name);
  } catch (error) {
    // An issue that doesn't exist is a bad link, not an outage. Treat it like any
    // other issue we can't tie to this customer.
    if (isNotFoundError(error)) {
      return {
        status: 'error',
        message: `Your ownership of this GitHub issue can't be validated.`,
      };
    }
    throw error;
  }

  if (labels.includes(LABEL_SUPPORT_PRIORITY)) {
    return {
      status: 'success',
      message: 'This GitHub issue was already validated. You can close this page.',
    };
  }

  if (!labels.includes(LABEL_SUPPORT_UNKNOWN)) {
    return {
      status: 'error',
      message: `Your ownership of this GitHub issue can't be validated.`,
    };
  }

  await octokit.issues.removeLabel({
    owner: OWNER,
    repo,
    issue_number: issueId,
    name: LABEL_SUPPORT_UNKNOWN,
  });
  await octokit.issues.addLabels({
    owner: OWNER,
    repo,
    issue_number: issueId,
    labels: [LABEL_SUPPORT_PRIORITY],
  });

  return {
    status: 'success',
    message: `Your GitHub issue #${issueId} was validated. You can now close this page.`,
  };
}

/**
 * Validates a customer's support key and, when it checks out, upgrades their GitHub
 * issue to priority support. Callers are expected to have validated the parameters
 * already; the API route does that with its request schema.
 */
export async function validateSupportKey({
  repo,
  issueId,
  supportKey,
}: ValidateSupportParams): Promise<ValidateSupportResult> {
  const record = await queryPurchasedSupportKey(supportKey);

  if (!record) {
    return { status: 'error', message: 'Your support key is invalid.' };
  }

  if (!record.active) {
    return {
      status: 'error',
      message: `Your support key is invalid. It expired on ${dayjs(record.expiresAt).format(
        'MMMM D, YYYY',
      )}.`,
    };
  }

  return updateSupportLabels(getOctokit(), repo, issueId);
}
