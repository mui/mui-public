import * as React from 'react';
import type { KpiResult } from '../types';
import { errorResult, successResult } from './utils';
import { getOctokit } from '../../github';

const WINDOW_DAYS = 30;
const ISSUE_RATIO_WINDOW_DAYS = 90;
const MS_PER_HOUR = 60 * 60 * 1000;

// Repository associations that count as maintainers. Former team members drop to
// CONTRIBUTOR, so they count as community.
const MAINTAINER_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

interface Actor {
  type: string;
  login: string;
}

interface PullRequestNode {
  createdAt: string;
  mergedAt: string;
  authorAssociation: string;
  author: Actor | null;
}

interface IssueNode {
  createdAt: string;
  author: Actor | null;
  comments: { nodes: { createdAt: string; author: Actor | null }[] };
}

interface SearchResult<TNode> {
  search: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: TNode[];
  };
}

const PULL_REQUESTS_QUERY = `
query searchMergedPullRequests($searchQuery: String!, $cursor: String) {
  search(query: $searchQuery, type: ISSUE, first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        createdAt
        mergedAt
        authorAssociation
        author { type: __typename login }
      }
    }
  }
}`;

// The first non-author, non-bot reply is almost always among the first few comments.
const ISSUES_QUERY = `
query searchIssues($searchQuery: String!, $cursor: String) {
  search(query: $searchQuery, type: ISSUE, first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on Issue {
        createdAt
        author { type: __typename login }
        comments(first: 10) {
          nodes {
            createdAt
            author { type: __typename login }
          }
        }
      }
    }
  }
}`;

function daysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function isBot(actor: Actor | null): boolean {
  if (!actor) {
    return false;
  }
  return actor.type === 'Bot' || /(\[bot\]|-bot)$/.test(actor.login);
}

// Nearest-rank percentile.
function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)];
}

async function searchAll<TNode>(graphqlQuery: string, searchQuery: string): Promise<TNode[]> {
  const nodes: TNode[] = [];
  let cursor: string | null = null;
  do {
    // eslint-disable-next-line no-await-in-loop
    const result: SearchResult<TNode> = await getOctokit().graphql<SearchResult<TNode>>(
      graphqlQuery,
      { searchQuery, cursor },
    );
    nodes.push(...result.search.nodes);
    cursor = result.search.pageInfo.hasNextPage ? result.search.pageInfo.endCursor : null;
  } while (cursor);
  return nodes;
}

// Shared by the time-to-merge and community KPIs within a render.
const fetchMergedPullRequests = React.cache(async (repo: string) => {
  const pullRequests = await searchAll<PullRequestNode>(
    PULL_REQUESTS_QUERY,
    `repo:mui/${repo} is:pr is:merged merged:>=${daysAgo(WINDOW_DAYS)}`,
  );
  return pullRequests.filter((pullRequest) => !isBot(pullRequest.author));
});

async function withPullRequests(
  repo: string,
  compute: (pullRequests: PullRequestNode[]) => KpiResult,
): Promise<KpiResult> {
  let pullRequests: PullRequestNode[];
  try {
    pullRequests = await fetchMergedPullRequests(repo);
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : 'GitHub GraphQL error');
  }
  return compute(pullRequests);
}

function splitByAuthor(pullRequests: PullRequestNode[]) {
  const community: PullRequestNode[] = [];
  const maintainers: PullRequestNode[] = [];
  for (const pullRequest of pullRequests) {
    if (MAINTAINER_ASSOCIATIONS.has(pullRequest.authorAssociation)) {
      maintainers.push(pullRequest);
    } else {
      community.push(pullRequest);
    }
  }
  return { community, maintainers };
}

function countAuthors(pullRequests: PullRequestNode[]): number {
  return new Set(pullRequests.map((pullRequest) => pullRequest.author?.login)).size;
}

export async function fetchTimeToMerge(repo: string): Promise<KpiResult> {
  return withPullRequests(repo, (pullRequests) => {
    if (pullRequests.length === 0) {
      return { value: null, metadata: 'No merged pull requests' };
    }
    const hours = pullRequests.map(
      (pullRequest) =>
        (Date.parse(pullRequest.mergedAt) - Date.parse(pullRequest.createdAt)) / MS_PER_HOUR,
    );
    const days = Math.round((percentile(hours, 0.75) / 24) * 100) / 100;
    return successResult(
      days,
      `75th percentile over the last ${WINDOW_DAYS} days (${pullRequests.length} PRs)`,
    );
  });
}

export async function fetchCommunityContributors(repo: string): Promise<KpiResult> {
  return withPullRequests(repo, (pullRequests) => {
    const { community, maintainers } = splitByAuthor(pullRequests);
    const maintainerCount = countAuthors(maintainers);
    if (maintainerCount === 0) {
      return { value: null, metadata: 'No maintainer pull requests' };
    }
    const communityCount = countAuthors(community);
    return successResult(
      Math.round((communityCount / maintainerCount) * 10) / 10,
      `${communityCount} community vs ${maintainerCount} maintainers, last ${WINDOW_DAYS} days`,
    );
  });
}

export async function fetchCommunityPullRequests(repo: string): Promise<KpiResult> {
  return withPullRequests(repo, (pullRequests) => {
    const { community, maintainers } = splitByAuthor(pullRequests);
    if (maintainers.length === 0) {
      return { value: null, metadata: 'No maintainer pull requests' };
    }
    return successResult(
      Math.round((community.length / maintainers.length) * 1000) / 10,
      `${community.length} community vs ${maintainers.length} maintainer PRs, last ${WINDOW_DAYS} days`,
    );
  });
}

export async function fetchIssueFirstResponse(repo: string): Promise<KpiResult> {
  let issues: IssueNode[];
  try {
    issues = await searchAll<IssueNode>(
      ISSUES_QUERY,
      `repo:mui/${repo} is:issue created:>=${daysAgo(WINDOW_DAYS)}`,
    );
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : 'GitHub GraphQL error');
  }

  const hours: number[] = [];
  for (const issue of issues) {
    if (isBot(issue.author)) {
      continue;
    }
    const response = issue.comments.nodes.find(
      (comment) =>
        comment.author && !isBot(comment.author) && comment.author.login !== issue.author?.login,
    );
    if (response) {
      hours.push((Date.parse(response.createdAt) - Date.parse(issue.createdAt)) / MS_PER_HOUR);
    }
  }

  if (hours.length === 0) {
    return { value: null, metadata: 'No responded issues' };
  }

  return successResult(
    Math.round(percentile(hours, 0.75)),
    `75th percentile over the last ${WINDOW_DAYS} days (${hours.length} responded issues)`,
  );
}

export async function fetchOpenedVsClosedIssues(repo: string): Promise<KpiResult> {
  const since = daysAgo(ISSUE_RATIO_WINDOW_DAYS);
  const octokit = getOctokit();
  const [opened, closed] = await Promise.all([
    octokit.rest.search.issuesAndPullRequests({
      q: `repo:mui/${repo} is:issue created:>=${since}`,
      per_page: 1,
    }),
    octokit.rest.search.issuesAndPullRequests({
      q: `repo:mui/${repo} is:issue closed:>=${since}`,
      per_page: 1,
    }),
  ]);

  if (closed.data.total_count === 0) {
    return { value: null, metadata: 'No closed issues' };
  }

  return successResult(
    Math.round((opened.data.total_count / closed.data.total_count) * 100) / 100,
    `${opened.data.total_count} opened vs ${closed.data.total_count} closed, last ${ISSUE_RATIO_WINDOW_DAYS} days`,
  );
}
