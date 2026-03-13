import type { TriageRow } from './types';
import {
  MUI_KPI_REPOS,
  LABEL_WAITING_FOR_MAINTAINER,
  LABEL_PR_OUT_OF_DATE,
  LABEL_PR_NEEDS_REVISION,
  LABEL_ON_HOLD,
  LABEL_DOCS_FEEDBACK,
} from '../../constants';
import { octokit } from '../github';

const PUBLIC_REPOS = MUI_KPI_REPOS.filter((r) => r.public);
const ALL_REPOS = MUI_KPI_REPOS;

interface TriageRowInput {
  id: number;
  number: number;
  title: string;
  html_url: string;
  repository_url?: string;
  repository?: { name: string };
  state?: string;
  labels: Array<string | { name?: string }>;
}

function toTriageRow(item: TriageRowInput): TriageRow {
  return {
    id: item.id,
    number: item.number,
    title: item.title,
    url: item.html_url,
    repository: item.repository?.name ?? item.repository_url ?? '',
    state: item.state,
    labels: item.labels.flatMap((label) => {
      if (typeof label === 'string') {
        return [label];
      }
      return label.name ? [label.name] : [];
    }),
  };
}

// 1. Issues without labels
export async function fetchIssuesWithoutLabels(): Promise<TriageRow[]> {
  const allRepoFilter = ALL_REPOS.map((r) => `repo:mui/${r.name}`).join(' ');

  const [closedData, openData] = await Promise.all([
    octokit.rest.search.issuesAndPullRequests({
      q: `is:issue is:closed no:label ${allRepoFilter}`,
      sort: 'updated',
      order: 'desc',
    }),
    octokit.rest.search.issuesAndPullRequests({
      q: 'is:issue no:label org:mui is:open',
      sort: 'updated',
      order: 'desc',
    }),
  ]);

  const items = [...closedData.data.items, ...openData.data.items];

  return items.map(toTriageRow);
}

// 2. PRs without labels (GraphQL)
interface GqlPrNode {
  number: number;
  url: string;
  title: string;
  state: string;
  isDraft: boolean;
  repository: { name: string };
  labels: { nodes: { name: string }[] };
}

interface GqlPrRepo {
  pullRequests: { nodes: GqlPrNode[] };
}

const FILTER_OUT_LABELS = [LABEL_PR_OUT_OF_DATE, LABEL_PR_NEEDS_REVISION];

function repoAlias(name: string): string {
  return name.replace(/-/g, '_');
}

export async function fetchPrsWithoutLabels(): Promise<TriageRow[]> {
  const allRepoFilter = ALL_REPOS.map((r) => `repo:mui/${r.name}`).join(' ');

  const prFields = `pullRequests(first: 100, orderBy: {direction: DESC, field: CREATED_AT}) {
        nodes { number url title state isDraft repository { name } labels(first: 10) { nodes { name } } }
      }`;

  const repoQueries = PUBLIC_REPOS.map(
    (r) => `${repoAlias(r.name)}: repository(owner: "mui", name: "${r.name}") { ${prFields} }`,
  ).join('\n    ');

  const query = `{ ${repoQueries} }`;

  const [result, mergedData] = await Promise.all([
    octokit.graphql<Record<string, GqlPrRepo>>(query),
    octokit.rest.search.issuesAndPullRequests({
      q: `is:pull-request no:label is:merged ${allRepoFilter}`,
      sort: 'updated',
      order: 'desc',
    }),
  ]);

  const allPrs = Object.values(result).flatMap((repo) => repo.pullRequests.nodes);

  const openPrs = allPrs
    .filter((pr) => !pr.isDraft)
    .filter(
      (pr) =>
        pr.labels.nodes.filter((label) => !FILTER_OUT_LABELS.includes(label.name)).length === 0,
    )
    .map((pr) => ({
      id: pr.number,
      number: pr.number,
      title: pr.title,
      url: pr.url,
      repository: pr.repository.name,
      state: pr.state,
      labels: pr.labels.nodes.map((l) => l.name),
    }));

  const mergedPrs = mergedData.data.items.map(toTriageRow);

  return [...openPrs, ...mergedPrs];
}

// 3. PRs without reviewer (GraphQL)
interface GqlPrReviewerNode {
  number: number;
  url: string;
  title: string;
  isDraft: boolean;
  createdAt: string;
  repository: { name: string };
  labels: { nodes: { name: string }[] };
  reviews: { nodes: { author: { name: string } | null }[] };
  reviewRequests: { nodes: { requestedReviewer: { name: string } | null }[] };
}

interface GqlPrReviewerRepo {
  pullRequests: { nodes: GqlPrReviewerNode[] };
}

export async function fetchPrsWithoutReviewer(): Promise<TriageRow[]> {
  const prFields = `
    nodes {
      number url title isDraft createdAt
      repository { name }
      labels(first: 10) { nodes { name } }
      reviews(first: 10) { nodes { author { ... on User { name } } } }
      reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { name } } } }
    }`;

  const repoQueries = PUBLIC_REPOS.map(
    (r) =>
      `${repoAlias(r.name)}: repository(owner: "mui", name: "${r.name}") {
      pullRequests(first: 100, orderBy: {direction: DESC, field: CREATED_AT}, states: OPEN) { ${prFields} }
    }`,
  ).join('\n    ');

  const query = `{ ${repoQueries} }`;

  const result: Record<string, GqlPrReviewerRepo> = await octokit.graphql(query);

  const allPrs = Object.values(result).flatMap((repo) => repo.pullRequests.nodes);

  const now = new Date();
  const rows: TriageRow[] = [];

  for (const pr of allPrs) {
    // Skip drafts
    if (pr.isDraft) {
      continue;
    }
    // Skip PRs that already have a reviewer or review request
    else if (pr.reviews.nodes.length > 0 || pr.reviewRequests.nodes.length > 0) {
      continue;
    }
    // Skip PRs on hold
    else if (pr.labels.nodes.some((label) => label.name === LABEL_ON_HOLD)) {
      continue;
    }

    const created = new Date(pr.createdAt);
    const diffMs = now.getTime() - created.getTime();
    const daysAgo = Math.ceil(diffMs / (1000 * 3600 * 24));

    // Allow mui-x PRs a 14-day grace period
    if (pr.repository.name === 'mui-x' && daysAgo < 14) {
      continue;
    }

    rows.push({
      id: pr.number,
      number: pr.number,
      title: pr.title,
      url: pr.url,
      repository: pr.repository.name,
      labels: pr.labels.nodes.map((l) => l.name),
      daysAgo,
    });
  }

  return rows;
}

// 4. Needs triage, not assigned
export async function fetchNeedsTriageNotAssigned(): Promise<TriageRow[]> {
  const repoFilter = PUBLIC_REPOS.map((r) => `repo:mui/${r.name}`).join(' ');

  const { data } = await octokit.rest.search.issuesAndPullRequests({
    q: `${repoFilter} is:open is:issue label:"${LABEL_WAITING_FOR_MAINTAINER}" no:assignee`,
  });

  return data.items.map(toTriageRow).sort((a, b) => {
    if (a.repository === 'mui-x') {
      return 1;
    }
    if (b.repository === 'mui-x') {
      return -1;
    }
    return 0;
  });
}

// 5. Issues without product scope
const NON_PRODUCT_SCOPE_LABELS = [LABEL_DOCS_FEEDBACK];

export async function fetchIssuesWithoutProductScope(): Promise<TriageRow[]> {
  const responses = await Promise.all(
    PUBLIC_REPOS.map((r) =>
      octokit.rest.issues.listForRepo({
        owner: 'mui',
        repo: r.name,
        labels: LABEL_WAITING_FOR_MAINTAINER,
        per_page: 100,
        state: 'all',
      }),
    ),
  );

  const allIssues = responses.flatMap((r, i) =>
    r.data.map((item) => ({ ...item, repository: { name: PUBLIC_REPOS[i].name } })),
  );

  return allIssues
    .filter((issue) => {
      const meaningfulLabels = issue.labels.filter(
        (label) =>
          typeof label === 'string' ||
          !label.name ||
          !NON_PRODUCT_SCOPE_LABELS.includes(label.name),
      );
      return meaningfulLabels.length === 1;
    })
    .sort((a, b) => {
      if (a.state === 'open') {
        return 1;
      }
      if (b.state === 'open') {
        return -1;
      }
      return b.number - a.number;
    })
    .map((item) => toTriageRow(item));
}

// 6. Closed issues no product scope
export async function fetchClosedIssuesNoProductScope(): Promise<TriageRow[]> {
  const responses = await Promise.all(
    PUBLIC_REPOS.map((r) =>
      octokit.rest.issues.listForRepo({
        owner: 'mui',
        repo: r.name,
        labels: LABEL_WAITING_FOR_MAINTAINER,
        per_page: 100,
        state: 'closed',
      }),
    ),
  );

  const allIssues = responses.flatMap((r, i) =>
    r.data.map((item) => ({ ...item, repository: { name: PUBLIC_REPOS[i].name } })),
  );

  return allIssues.sort((a, b) => b.number - a.number).map((item) => toTriageRow(item));
}
