import type { KpiResult } from '../types';
import { checkHttpError, errorResult, getEnvOrError, successResult } from './utils';

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

function getAuthHeaders(): HeadersInit {
  if (!GITHUB_TOKEN) {
    return {};
  }
  return { Authorization: `Bearer ${GITHUB_TOKEN}` };
}

export async function fetchOpenPRs(repo: string): Promise<KpiResult> {
  const query = encodeURIComponent(`is:pull-request is:open -is:draft repo:mui/${repo}`);
  const response = await fetch(`https://api.github.com/search/issues?q=${query}`, {
    headers: getAuthHeaders(),
    next: { revalidate: 3600 },
  });

  const httpError = checkHttpError(response);
  if (httpError) {
    return httpError;
  }

  const data = await response.json();
  return { value: data.total_count };
}

export async function fetchWaitingForMaintainer(repo: string): Promise<KpiResult> {
  const query = encodeURIComponent(
    `is:issue repo:mui/${repo} label:"status: waiting for maintainer"`,
  );
  const response = await fetch(`https://api.github.com/search/issues?q=${query}`, {
    headers: getAuthHeaders(),
    next: { revalidate: 3600 },
  });

  const httpError = checkHttpError(response);
  if (httpError) {
    return httpError;
  }

  const data = await response.json();
  return { value: data.total_count };
}

export async function fetchMissingGitHubLabel(): Promise<KpiResult> {
  const headers = getAuthHeaders();

  const [openNoLabels, closedNoLabels, mergedNoLabels] = await Promise.all([
    fetch(
      `https://api.github.com/search/issues?q=${encodeURIComponent('no:label is:open org:mui')}`,
      { headers, next: { revalidate: 3600 } },
    ).then((r) => r.json()),
    fetch(
      `https://api.github.com/search/issues?q=${encodeURIComponent(
        'is:issue no:label is:close repo:mui/mui-x repo:mui/mui-design-kits repo:mui/material-ui repo:mui/mui-private repo:mui/mui-public repo:mui/base-ui repo:mui/pigment-css',
      )}`,
      { headers, next: { revalidate: 3600 } },
    ).then((r) => r.json()),
    fetch(
      `https://api.github.com/search/issues?q=${encodeURIComponent(
        'is:pull-request no:label is:merged repo:mui/mui-x repo:mui/mui-design-kits repo:mui/material-ui repo:mui/base-ui repo:mui/pigment-css',
      )}`,
      { headers, next: { revalidate: 3600 } },
    ).then((r) => r.json()),
  ]);

  const items = [
    ...(openNoLabels.items || []),
    ...(closedNoLabels.items || []),
    ...(mergedNoLabels.items || []),
  ];

  interface GitHubItem {
    draft?: boolean;
  }

  const total = items.filter((item: GitHubItem) => !item.draft).length;

  return { value: total };
}

export async function fetchCommitStatuses(repository: string): Promise<KpiResult> {
  const token = getEnvOrError('GITHUB_TOKEN');
  if (typeof token !== 'string') {
    return token;
  }

  const since = new Date();
  since.setDate(since.getDate() - 7);

  const query = `
query getCommitStatuses($repository: String!, $since: GitTimestamp!) {
  repository(owner: "mui", name: $repository) {
    defaultBranchRef {
      target {
        ... on Commit {
          history(since: $since) {
            nodes {
              status {
                state
              }
            }
          }
        }
      }
    }
  }
}`;

  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      query,
      variables: {
        repository,
        since: since.toISOString(),
      },
    }),
    next: { revalidate: 3600 },
  });

  const httpError = checkHttpError(response);
  if (httpError) {
    return httpError;
  }

  const data = await response.json();

  if (data.errors) {
    return errorResult(data.errors[0]?.message || 'GraphQL error');
  }

  interface CommitNode {
    status: { state: string } | null;
  }

  const nodes: CommitNode[] = data.data?.repository?.defaultBranchRef?.target?.history?.nodes || [];

  if (nodes.length === 0) {
    return { value: null, metadata: 'No commits found' };
  }

  const successOrPending = nodes.filter(
    (commit) =>
      commit.status && (commit.status.state === 'SUCCESS' || commit.status.state === 'PENDING'),
  );

  const rate = Math.round((successOrPending.length / nodes.length) * 100);

  return successResult(rate, `Based on the last 7 days (${nodes.length} commits)`);
}
