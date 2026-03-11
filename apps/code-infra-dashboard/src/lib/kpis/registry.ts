import type { KpiConfig } from './types';
import * as github from './fetchers/github';
import * as zendesk from './fetchers/zendesk';
import * as ossInsight from './fetchers/ossInsight';
import * as circleCI from './fetchers/circleCI';
import * as hibob from './fetchers/hibob';
import * as store from './fetchers/store';

interface Repo {
  name: string;
  label: string;
  ossInsightId: string;
}

const REPOS: Repo[] = [
  { name: 'material-ui', label: 'MUI Core', ossInsightId: '23083156' },
  { name: 'mui-x', label: 'MUI X', ossInsightId: '260240241' },
  { name: 'base-ui', label: 'Base UI', ossInsightId: '762289766' },
];

async function fetchOpenPRs(repoName: string) {
  'use server';
  return github.fetchOpenPRs(repoName);
}

function createOpenPRsCard(repo: Repo): KpiConfig<[string]> {
  return {
    id: `open-prs-${repo.name}`,
    title: `Open PRs - ${repo.label}`,
    description: 'Count of open, non-draft pull requests',
    unit: ' open PRs',
    thresholds: { warning: 50, problem: 75, lowerIsBetter: true },
    group: repo.label,
    fetchParams: [repo.name],
    fetch: fetchOpenPRs,
  };
}

async function fetchWaitingForMaintainer(repoName: string) {
  'use server';
  return github.fetchWaitingForMaintainer(repoName);
}

function createWaitingForMaintainerCard(repo: Repo): KpiConfig<[string]> {
  return {
    id: `waiting-for-maintainer-${repo.name}`,
    title: `Waiting for Maintainer - ${repo.label}`,
    description: 'Issues waiting for maintainer response',
    unit: ' issues',
    thresholds: { warning: 25, problem: 50, lowerIsBetter: true },
    group: repo.label,
    fetchParams: [repo.name],
    fetch: fetchWaitingForMaintainer,
  };
}

async function fetchHeadCISuccessRate(repoName: string) {
  'use server';
  return github.fetchCommitStatuses(repoName);
}

function createHeadCISuccessRateCard(repo: Repo): KpiConfig<[string]> {
  return {
    id: `head-ci-success-rate-${repo.name}`,
    title: `Head CI Success Rate - ${repo.label}`,
    description: 'CI success rate for the default branch',
    unit: '%',
    thresholds: { warning: 75, problem: 50, lowerIsBetter: false },
    group: repo.label,
    fetchParams: [repo.name],
    fetch: fetchHeadCISuccessRate,
  };
}

async function fetchMedianTimeToCompletion(ossInsightId: string) {
  'use server';
  return ossInsight.fetchMedianTimeToCompletion(ossInsightId);
}

function createMedianTimeToCompletionCard(repo: Repo): KpiConfig<[string]> {
  return {
    id: `median-time-to-completion-${repo.name}`,
    title: `Median Time to Completion - ${repo.label}`,
    description: 'Median time for pull requests to be merged',
    unit: ' days',
    thresholds: { warning: 3, problem: 5, lowerIsBetter: true },
    group: repo.label,
    fetchParams: [repo.ossInsightId],
    fetch: fetchMedianTimeToCompletion,
  };
}

async function fetchIssueFirstComment(ossInsightId: string) {
  'use server';
  return ossInsight.fetchIssueFirstComment(ossInsightId);
}

function createIssueFirstCommentCard(repo: Repo): KpiConfig<[string]> {
  return {
    id: `issue-first-comment-${repo.name}`,
    title: `Issue First Comment - ${repo.label}`,
    description: 'Median time for first response to issues',
    unit: ' hours',
    thresholds: { warning: 8, problem: 24, lowerIsBetter: true },
    group: repo.label,
    fetchParams: [repo.ossInsightId],
    fetch: fetchIssueFirstComment,
  };
}

async function fetchClosedVsOpenedIssues(ossInsightId: string) {
  'use server';
  return ossInsight.fetchClosedVsOpenedIssues(ossInsightId);
}

function createClosedVsOpenedIssuesCard(repo: Repo): KpiConfig<[string]> {
  return {
    id: `closed-vs-opened-issues-${repo.name}`,
    title: `Closed vs Opened Issues - ${repo.label}`,
    description: 'Ratio of opened to closed issues over last 3 months',
    unit: ' ratio',
    thresholds: { warning: 2, problem: 2, lowerIsBetter: true },
    group: repo.label,
    fetchParams: [repo.ossInsightId],
    fetch: fetchClosedVsOpenedIssues,
  };
}

async function fetchCommunityContributors(ossInsightId: string) {
  'use server';
  return ossInsight.fetchContributorsPerMonth(ossInsightId);
}

function createCommunityContributorsCard(repo: Repo): KpiConfig<[string]> {
  return {
    id: `community-contributors-${repo.name}`,
    title: `Community Contributors - ${repo.label}`,
    description: 'Ratio of community contributors to maintainers',
    unit: 'x',
    thresholds: { warning: 3, problem: 2, lowerIsBetter: false },
    group: repo.label,
    fetchParams: [repo.ossInsightId],
    fetch: fetchCommunityContributors,
  };
}

async function fetchCommunityPRs(ossInsightId: string) {
  'use server';
  return ossInsight.fetchPrsPerMonth(ossInsightId);
}

function createCommunityPRsCard(repo: Repo): KpiConfig<[string]> {
  return {
    id: `community-prs-${repo.name}`,
    title: `Community PRs - ${repo.label}`,
    description: 'Ratio of community PRs to maintainer PRs',
    unit: '%',
    thresholds: { warning: 50, problem: 35, lowerIsBetter: false },
    group: repo.label,
    fetchParams: [repo.ossInsightId],
    fetch: fetchCommunityPRs,
  };
}

async function fetchCICompletionTime(repoName: string) {
  'use server';
  return circleCI.fetchCompletionTime(repoName);
}

function createCICompletionTimeCard(repo: Repo): KpiConfig<[string]> {
  return {
    id: `ci-completion-time-${repo.name}`,
    title: `CI Completion Time - ${repo.label}`,
    description: 'Median CI pipeline completion time',
    unit: ' minutes',
    thresholds: { warning: 15, problem: 20, lowerIsBetter: true },
    group: repo.label,
    fetchParams: [repo.name],
    fetch: fetchCICompletionTime,
  };
}

async function fetchMissingGitHubLabel(repoName: string) {
  'use server';
  return github.fetchMissingGitHubLabel(repoName);
}

function createMissingGitHubLabelCard(repo: Repo): KpiConfig<[string]> {
  return {
    id: `missing-github-label-${repo.name}`,
    title: `Missing GitHub Label - ${repo.label}`,
    description: 'Open issues and PRs without labels',
    unit: ' issues or PRs',
    thresholds: { warning: 1, problem: 10, lowerIsBetter: true },
    group: repo.label,
    fetchParams: [repo.name],
    fetch: fetchMissingGitHubLabel,
  };
}

export const kpiRegistry: KpiConfig<any[]>[] = [
  // Per-repo KPIs
  ...REPOS.flatMap((repo) => [
    createOpenPRsCard(repo),
    createWaitingForMaintainerCard(repo),
    createMissingGitHubLabelCard(repo),
    createHeadCISuccessRateCard(repo),
    createMedianTimeToCompletionCard(repo),
    createIssueFirstCommentCard(repo),
    createClosedVsOpenedIssuesCard(repo),
    createCommunityContributorsCard(repo),
    createCommunityPRsCard(repo),
    createCICompletionTimeCard(repo),
  ]),

  // Zendesk API KPIs
  {
    id: 'zendesk-first-reply',
    title: 'Zendesk First Reply',
    description: 'Median time for first reply to support tickets',
    unit: ' hours',
    thresholds: { warning: 5, problem: 8, lowerIsBetter: true },
    group: 'Support',
    fetch: async () => {
      'use server';
      return zendesk.fetchFirstReply();
    },
  },
  {
    id: 'zendesk-satisfaction-score',
    title: 'Zendesk Satisfaction Score',
    description: 'Percentage of satisfaction ratings scored as good',
    unit: '%',
    thresholds: { warning: 90, problem: 80, lowerIsBetter: false },
    group: 'Support',
    fetch: async () => {
      'use server';
      return zendesk.fetchSatisfactionScore();
    },
  },

  // HiBob API KPIs
  {
    id: 'gender',
    title: 'Gender',
    description: 'Gender percentage across organization',
    unit: '%',
    thresholds: { warning: 30, problem: 15, lowerIsBetter: false },
    group: 'People',
    fetch: async () => {
      'use server';
      return hibob.fetchGender();
    },
  },
  {
    id: 'gender-engineering',
    title: 'Gender in Engineering',
    description: 'Gender percentage in the engineering department',
    unit: '%',
    thresholds: { warning: 14, problem: 7, lowerIsBetter: false },
    group: 'People',
    fetch: async () => {
      'use server';
      return hibob.fetchGender('256186803');
    },
  },
  {
    id: 'gender-management',
    title: 'Gender in Management',
    description: 'Gender percentage in management',
    unit: '%',
    thresholds: { warning: 30, problem: 15, lowerIsBetter: false },
    group: 'People',
    fetch: async () => {
      'use server';
      return hibob.fetchGenderManagement();
    },
  },

  // Store DB KPI
  {
    id: 'overdue-ratio',
    title: 'Overdue Ratio',
    description: 'Ratio of overdue invoices',
    unit: '%',
    thresholds: { warning: 10, problem: 15, lowerIsBetter: true },
    group: 'Store',
    fetch: async () => {
      'use server';
      return store.fetchOverdueRatio();
    },
  },
];

export function getKpiById(id: string): KpiConfig<any[]> | undefined {
  return kpiRegistry.find((kpi) => kpi.id === id);
}

export function getAllKpiIds(): string[] {
  return kpiRegistry.map((kpi) => kpi.id);
}
