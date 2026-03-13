import * as React from 'react';
import type { KpiResult } from '../types';
import { errorResult, successResult } from './utils';
import { MUI_KPI_REPOS, LABEL_WAITING_FOR_MAINTAINER } from '../../../constants';
import { octokit } from '../../github';

interface MissingLabelItem {
  repository_url: string;
  draft?: boolean;
}

export async function fetchOpenPRs(repo: string): Promise<KpiResult> {
  const { data } = await octokit.rest.search.issuesAndPullRequests({
    q: `is:pull-request is:open -is:draft repo:mui/${repo}`,
  });

  return { value: data.total_count };
}

export async function fetchWaitingForMaintainer(repo: string): Promise<KpiResult> {
  const { data } = await octokit.rest.search.issuesAndPullRequests({
    q: `is:issue repo:mui/${repo} label:"${LABEL_WAITING_FOR_MAINTAINER}"`,
  });

  return { value: data.total_count };
}

const fetchAllMissingLabelItems = React.cache(async (): Promise<MissingLabelItem[]> => {
  const repoFilter = MUI_KPI_REPOS.map((r) => `repo:mui/${r.name}`).join(' ');

  const [openNoLabels, closedNoLabels, mergedNoLabels] = await Promise.all([
    octokit.rest.search.issuesAndPullRequests({
      q: `no:label is:open ${repoFilter}`,
    }),
    octokit.rest.search.issuesAndPullRequests({
      q: `is:issue no:label is:close ${repoFilter}`,
    }),
    octokit.rest.search.issuesAndPullRequests({
      q: `is:pull-request no:label is:merged ${repoFilter}`,
    }),
  ]);

  const items: MissingLabelItem[] = [
    ...(openNoLabels.data.items || []),
    ...(closedNoLabels.data.items || []),
    ...(mergedNoLabels.data.items || []),
  ];

  return items.filter((item) => !item.draft);
});

export async function fetchMissingGitHubLabel(repoName: string): Promise<KpiResult> {
  const items = await fetchAllMissingLabelItems();
  const count = items.filter(
    (item) => item.repository_url === `https://api.github.com/repos/mui/${repoName}`,
  ).length;
  return { value: count };
}

export async function fetchCommitStatuses(repository: string): Promise<KpiResult> {
  if (!process.env.GITHUB_TOKEN) {
    return errorResult('GITHUB_TOKEN not configured');
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

  interface CommitNode {
    status: { state: string } | null;
  }

  interface GraphQLResult {
    repository: {
      defaultBranchRef: {
        target: {
          history: {
            nodes: CommitNode[];
          };
        };
      };
    };
  }

  let result: GraphQLResult;
  try {
    result = await octokit.graphql<GraphQLResult>(query, {
      repository,
      since: since.toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'GraphQL error';
    return errorResult(message);
  }

  const nodes: CommitNode[] = result?.repository?.defaultBranchRef?.target?.history?.nodes || [];

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
