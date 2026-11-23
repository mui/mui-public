import type { KpiConfig, KpiInfo } from './types';
import type { Repository } from '../../constants';
import { MUI_KPI_REPOS } from '../../constants';
import * as github from './fetchers/github';
import * as zendesk from './fetchers/zendesk';
import * as circleCI from './fetchers/circleCI';
import * as hibob from './fetchers/hibob';
import * as store from './fetchers/store';

const REPOS = MUI_KPI_REPOS.filter((repo) =>
  ['material-ui', 'mui-x', 'base-ui'].includes(repo.name),
);

async function fetchOpenPRs(repoName: string) {
  return github.fetchOpenPRs(repoName);
}

function createOpenPRsCard(repo: Repository): KpiConfig<[string]> {
  return {
    id: `open-prs-${repo.name}`,
    title: `Open PRs - ${repo.displayName}`,
    description: 'Count of open, non-draft pull requests',
    unit: ' open PRs',
    thresholds: { warning: 50, problem: 75, lowerIsBetter: true },
    group: repo.displayName,
    fetchParams: [repo.name],
    fetch: fetchOpenPRs,
  };
}

async function fetchWaitingForMaintainer(repoName: string) {
  return github.fetchWaitingForMaintainer(repoName);
}

function createWaitingForMaintainerCard(repo: Repository): KpiConfig<[string]> {
  return {
    id: `waiting-for-maintainer-${repo.name}`,
    title: `Waiting for Maintainer - ${repo.displayName}`,
    description: 'Issues waiting for maintainer response',
    unit: ' issues',
    thresholds: { warning: 25, problem: 50, lowerIsBetter: true },
    group: repo.displayName,
    fetchParams: [repo.name],
    fetch: fetchWaitingForMaintainer,
  };
}

async function fetchHeadCISuccessRate(repoName: string) {
  return github.fetchCommitStatuses(repoName);
}

function createHeadCISuccessRateCard(repo: Repository): KpiConfig<[string]> {
  return {
    id: `head-ci-success-rate-${repo.name}`,
    title: `Head CI Success Rate - ${repo.displayName}`,
    description: 'CI success rate for the default branch',
    unit: '%',
    thresholds: { warning: 75, problem: 50, lowerIsBetter: false },
    group: repo.displayName,
    fetchParams: [repo.name],
    fetch: fetchHeadCISuccessRate,
  };
}

async function fetchCICompletionTime(repoName: string) {
  return circleCI.fetchCompletionTime(repoName);
}

function createCICompletionTimeCard(repo: Repository): KpiConfig<[string]> {
  return {
    id: `ci-completion-time-${repo.name}`,
    title: `CI Completion Time - ${repo.displayName}`,
    description: 'Median CI pipeline completion time',
    unit: ' minutes',
    thresholds: { warning: 15, problem: 20, lowerIsBetter: true },
    group: repo.displayName,
    fetchParams: [repo.name],
    fetch: fetchCICompletionTime,
  };
}

async function fetchMissingGitHubLabel(repoName: string) {
  return github.fetchMissingGitHubLabel(repoName);
}

function createMissingGitHubLabelCard(repo: Repository): KpiConfig<[string]> {
  return {
    id: `missing-github-label-${repo.name}`,
    title: `Missing GitHub Label - ${repo.displayName}`,
    description: 'Open issues and PRs without labels',
    unit: ' issues or PRs',
    thresholds: { warning: 1, problem: 10, lowerIsBetter: true },
    group: repo.displayName,
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
      return store.fetchOverdueRatio();
    },
  },
];

export function getKpiById(id: string): KpiConfig<any[]> | undefined {
  return kpiRegistry.find((kpi) => kpi.id === id);
}

export function toKpiInfo(kpi: KpiConfig<any[]>): KpiInfo {
  const { id, title, description, unit, thresholds, group } = kpi;
  return { id, title, description, unit, thresholds, group };
}

export function getAllKpiIds(): string[] {
  return kpiRegistry.map((kpi) => kpi.id);
}
