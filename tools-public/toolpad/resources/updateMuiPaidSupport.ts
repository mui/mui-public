/* eslint-disable import/prefer-default-export */
import dayjs from 'dayjs';
import { sheets } from '@googleapis/sheets';
import { JWT } from 'google-auth-library';
import { Octokit } from '@octokit/core';
import { queryStoreDatabase } from './queryStoreDatabase';

function findRowIndexByValue(sheet, value) {
  for (let i = 0; i < sheet.length; i += 1) {
    if (sheet[i][0] === value) {
      return i;
    }
  }
  return -1;
}

async function queryPurchasedSupportKey(supportKey: string) {
  return queryStoreDatabase(async (connection) => {
    const [result] = await connection.execute(
      'select count(*) from wp3u_x_addons where license_key = ? and expire_at > now()',
      [supportKey],
    );

    // eslint-disable-next-line no-console
    console.log('queryPurchasedSupportKey', JSON.stringify(result, null, 2));

    return result[0] >= 1;
  }).catch(() => false);
}

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
      message: 'GitHub issue already validated. You can now close this page.',
    };
  }

  if (!labels.includes('support: unknown')) {
    return {
      status: 'error',
      message: `We can't validate the ownership of this GitHub issue.`,
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
    message: 'GitHub issue validated. You can now close this page.',
  };
}

export async function updateMuiPaidSupport(issueId: string, repo: string, supportKey: string) {
  if (!process.env.GOOGLE_SHEET_TOKEN) {
    throw new Error('Env variable GOOGLE_SHEET_TOKEN not configured');
  }

  if (supportKey === '') {
    return {
      message: 'Provide your support key above',
    };
  }

  if (issueId === '') {
    return {
      message: 'Missing issue id',
    };
  }

  if (repo === '') {
    return {
      message: 'Missing repo',
    };
  }

  const isPurchasedSupportKey = await queryPurchasedSupportKey(supportKey);
  if (isPurchasedSupportKey) {
    return updateGitHubIssueLabels(repo, issueId);
  }

  const googleAuth = new JWT({
    email: 'service-account-804@docs-feedbacks.iam.gserviceaccount.com',
    key: process.env.GOOGLE_SHEET_TOKEN.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const service = sheets({ version: 'v4', auth: googleAuth });
  const spreadsheetId = '1RNYabJOzAs4pzMN6WI0yAfeGXOqDiMU1t8TpqA1EPjE';

  const res = await service.spreadsheets.values.get({
    spreadsheetId,
    range: 'Sheet1!A2:B50',
  });

  const rows = res.data.values;
  const rowIndex = findRowIndexByValue(rows, supportKey);

  if (rowIndex === -1) {
    return {
      message: 'Invalid support key',
    };
  }

  const targetSupportKeyExpirationDate = new Date(rows![rowIndex][1]);
  const today = new Date();

  if (targetSupportKeyExpirationDate < today) {
    return {
      message: `You support key expired on ${dayjs(targetSupportKeyExpirationDate).format(
        'MMMM D, YYYY',
      )}.`,
    };
  }

  return updateGitHubIssueLabels(repo, issueId);
}
