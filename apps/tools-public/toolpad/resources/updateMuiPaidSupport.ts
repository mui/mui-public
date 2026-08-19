import dayjs from 'dayjs';
import { Octokit } from '@octokit/core';
import { queryStoreDatabase } from './queryStoreDatabase';

async function updateGitHubIssueLabels(repo, issueId) {
  if (!process.env.GITHUB_MUI_BOT2_PUBLIC_REPO_TOKEN) {
    throw new Error('Env variable GITHUB_MUI_BOT2_PUBLIC_REPO_TOKEN not configured');
  }

  const octokit = new Octokit({
    auth: process.env.GITHUB_MUI_BOT2_PUBLIC_REPO_TOKEN,
  });

  const octokitRequestMetadata = {
    owner: 'mui',
    repo,
    issue_number: issueId,
    headers: {
      'X-GitHub-Api-Version': '2022-11-28',
    },
  };

  const labelsRes = await octokit.request(
    'GET /repos/{owner}/{repo}/issues/{issue_number}/labels',
    octokitRequestMetadata,
  );
  const labels = labelsRes.data.map((label) => label.name);

  if (labels.includes('support: priority')) {
    return {
      status: 'success',
      message: 'This GitHub issue was already validated. You can close this page.',
    };
  }

  if (!labels.includes('support: unknown')) {
    return {
      status: 'error',
      message: `Your ownership of this GitHub issue can't be validated.`,
    };
  }

  await octokit.request('DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}', {
    ...octokitRequestMetadata,
    name: 'support: unknown',
  });

  await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/labels', {
    ...octokitRequestMetadata,
    labels: ['support: priority'],
  });

  return {
    status: 'success',
    message: `Your GitHub issue #${issueId} was validated. You can now close this page.`,
  };
}

async function queryPurchasedSupportKey(supportKey: string) {
  return queryStoreDatabase(async (connection) => {
    const [rows] = await connection.execute(
      'select count(*) as found, expire_at, expire_at > now() as active from wp3u_x_addons where license_key = ?',
      [supportKey],
    );
    const hit = rows?.[0] ?? { found: 0 };
    return hit;
  }).catch(() => false);
}

export async function updateMuiPaidSupport(issueId: string, repo: string, supportKey: string) {
  if (supportKey === '') {
    return {
      status: 'error',
      message: 'Provide your support key above.',
    };
  }

  if (issueId === '') {
    return {
      status: 'error',
      message: 'Missing issue id.',
    };
  }

  if (repo === '') {
    return {
      status: 'error',
      message: 'Missing repository.',
    };
  }

  const purchasedSupportKey = await queryPurchasedSupportKey(supportKey);

  if (purchasedSupportKey.found !== 1) {
    return {
      status: 'error',
      message: 'Your support key is invalid.',
    };
  }

  if (purchasedSupportKey.active === 0) {
    return {
      status: 'error',
      message: `Your support key is invalid. It expired on ${dayjs(
        purchasedSupportKey.expire_at,
      ).format('MMMM D, YYYY')}.`,
    };
  }

  return updateGitHubIssueLabels(repo, issueId);
}
