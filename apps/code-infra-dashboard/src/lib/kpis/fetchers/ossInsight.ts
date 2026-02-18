import type { KpiResult } from '../types';
import { checkHttpError, successResult } from './utils';

function getFirstDayOfPreviousMonth(): string {
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth();

  let previousMonth: number;
  let previousYear: number;

  if (currentMonth === 0) {
    previousMonth = 11;
    previousYear = currentYear - 1;
  } else {
    previousMonth = currentMonth - 1;
    previousYear = currentYear;
  }

  const d = 1;
  const m = previousMonth + 1;
  const y = previousYear;
  return `${y}-${m <= 9 ? `0${m}` : m}-${d <= 9 ? `0${d}` : d}`;
}

export async function fetchMedianTimeToCompletion(repoId: string): Promise<KpiResult> {
  const response = await fetch(
    `https://api.ossinsight.io/q/analyze-pull-request-open-to-merged?repoId=${repoId}`,
    { next: { revalidate: 3600 } },
  );

  const httpError = checkHttpError(response);
  if (httpError) {
    return httpError;
  }

  const data = await response.json();
  const latest = data.data[data.data.length - 1];

  if (latest?.p75 == null) {
    return { value: null };
  }

  const days = Math.round((latest.p75 / 24) * 100) / 100;
  return successResult(days, `Based on the last 30 days (${latest.event_month})`);
}

export async function fetchIssueFirstComment(repoId: string): Promise<KpiResult> {
  const response = await fetch(
    `https://api.ossinsight.io/q/analyze-issue-open-to-first-responded?repoId=${repoId}`,
    { next: { revalidate: 3600 } },
  );

  const httpError = checkHttpError(response);
  if (httpError) {
    return httpError;
  }

  const data = await response.json();
  const latest = data.data[data.data.length - 1];

  if (latest?.p75 == null) {
    return { value: null };
  }

  return successResult(
    Math.round(latest.p75),
    `Based on the last 30 days (since ${latest.event_month})`,
  );
}

export async function fetchClosedVsOpenedIssues(repoId: string): Promise<KpiResult> {
  const response = await fetch(
    `https://api.ossinsight.io/q/analyze-issue-opened-and-closed?repoId=${repoId}`,
    { next: { revalidate: 3600 } },
  );

  const httpError = checkHttpError(response);
  if (httpError) {
    return httpError;
  }

  const data = await response.json();
  const timeSpanInMonths = 3;
  let totalOpened = 0;
  let totalClosed = 0;

  for (let i = 0; i < timeSpanInMonths && i < data.data.length; i += 1) {
    totalClosed += Number(data.data[i].closed);
    totalOpened += Number(data.data[i].opened);
  }

  if (totalClosed === 0) {
    return { value: null };
  }

  return successResult(
    parseFloat((totalOpened / totalClosed).toFixed(2)),
    'Based on the last 3 months',
  );
}

export async function fetchContributorsPerMonth(repositoryId: string): Promise<KpiResult> {
  const startDate = getFirstDayOfPreviousMonth();

  const sql = `
with maintainers as (
  SELECT
    DISTINCT ge.actor_login
  FROM
    github_events ge
  WHERE
    ge.repo_id = ${repositoryId}
    AND ge.type = 'PullRequestEvent'
    AND ge.action = 'closed'
    AND ge.pr_merged = 1
    AND ge.created_at >= '2016-01-01'
), pr_merged AS (
  SELECT
    number,
    date_format(created_at, '%Y-%m-01') AS event_month,
    actor_login
  FROM
    github_events ge
  WHERE
    type = 'PullRequestEvent'
    AND action = 'closed'
    AND ge.pr_merged = 1
    AND repo_id = ${repositoryId}
    AND ge.created_at >= '${startDate}'
), pr_opened as (
  SELECT
    number,
    date_format(created_at, '%Y-%m-01') AS event_month,
    actor_login
  FROM
    github_events ge
  WHERE
    type = 'PullRequestEvent'
    AND action = 'opened'
    AND repo_id = ${repositoryId}
    AND ge.created_at >= '2016-01-01'
    AND actor_login NOT LIKE '%bot'
    AND actor_login NOT LIKE '%[bot]'
), pr_merged_with_open_by as (
  SELECT
    pr_merged.event_month,
    pr_merged.number,
    pr_opened.actor_login as open_by,
    pr_merged.actor_login as merged_by
  FROM
    pr_merged
    JOIN pr_opened on pr_opened.number = pr_merged.number
), pr_stats as (
  SELECT
    pr_community.event_month,
    COUNT(DISTINCT pr_community.open_by) AS pr_community_count,
    COUNT(DISTINCT pr_maintainers.open_by) AS pr_maintainers_count
  FROM pr_merged_with_open_by as pr_community
  LEFT JOIN pr_merged_with_open_by  as pr_maintainers
    ON pr_community.event_month = pr_maintainers.event_month
  WHERE
        pr_community.open_by NOT IN (SELECT actor_login FROM maintainers)
    AND pr_maintainers.open_by IN (SELECT actor_login FROM maintainers)
  GROUP BY
    pr_community.event_month
  ORDER BY
    pr_community.event_month asc
)
SELECT * FROM pr_stats ge;
  `;

  const response = await fetch('https://api.ossinsight.io/q/playground', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sql, type: 'repo', id: repositoryId }),
    next: { revalidate: 3600 },
  });

  const httpError = checkHttpError(response);
  if (httpError) {
    return httpError;
  }

  const data = await response.json();

  if (data.data.length === 0) {
    return successResult(0, 'No data for current period');
  }

  const latest = data.data[0];
  const ratio = Math.round((latest.pr_community_count / latest.pr_maintainers_count) * 10) / 10;

  return successResult(ratio, `For ${latest.event_month}`);
}

export async function fetchPrsPerMonth(repositoryId: string): Promise<KpiResult> {
  const startDate = getFirstDayOfPreviousMonth();

  const sql = `
with maintainers as (
  SELECT
    DISTINCT ge.actor_login
  FROM
    github_events ge
  WHERE
    ge.repo_id = ${repositoryId}
    AND ge.type = 'PullRequestEvent'
    AND ge.action = 'closed'
    AND ge.pr_merged = 1
    AND ge.created_at >= '2016-01-01'
), pr_merged AS (
  SELECT
    number,
    date_format(created_at, '%Y-%m-01') AS event_month,
    actor_login
  FROM
    github_events ge
  WHERE
    type = 'PullRequestEvent'
    AND action = 'closed'
    AND ge.pr_merged = 1
    AND repo_id = ${repositoryId}
    AND ge.created_at >= '${startDate}'
), pr_opened as (
  SELECT
    number,
    date_format(created_at, '%Y-%m-01') AS event_month,
    actor_login
  FROM
    github_events ge
  WHERE
    type = 'PullRequestEvent'
    AND action = 'opened'
    AND repo_id = ${repositoryId}
    AND ge.created_at >= '2016-01-01'
    AND actor_login NOT LIKE '%bot'
    AND actor_login NOT LIKE '%[bot]'
), pr_merged_with_open_by as (
  SELECT
    pr_merged.event_month,
    pr_merged.number,
    pr_opened.actor_login as open_by,
    pr_merged.actor_login as merged_by
  FROM
    pr_merged
    JOIN pr_opened on pr_opened.number = pr_merged.number
), pr_stats as (
  SELECT
    pr_community.event_month,
    COUNT(DISTINCT pr_community.number) AS pr_community_count,
    COUNT(DISTINCT pr_maintainers.number) AS pr_maintainers_count
  FROM pr_merged_with_open_by as pr_community
  LEFT JOIN pr_merged_with_open_by  as pr_maintainers
    ON pr_community.event_month = pr_maintainers.event_month
  WHERE
        pr_community.open_by NOT IN (SELECT actor_login FROM maintainers)
    AND pr_maintainers.open_by IN (SELECT actor_login FROM maintainers)
  GROUP BY
    pr_community.event_month
  ORDER BY
    pr_community.event_month asc
)
SELECT * FROM pr_stats ge;
  `;

  const response = await fetch('https://api.ossinsight.io/q/playground', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sql, type: 'repo', id: repositoryId }),
    next: { revalidate: 3600 },
  });

  const httpError = checkHttpError(response);
  if (httpError) {
    return httpError;
  }

  const data = await response.json();

  if (data.data.length === 0) {
    return successResult(0, 'No data for current period');
  }

  const latest = data.data[0];
  const ratio = Math.round((latest.pr_community_count / latest.pr_maintainers_count) * 1000) / 10;

  return successResult(ratio, `For ${latest.event_month}`);
}
