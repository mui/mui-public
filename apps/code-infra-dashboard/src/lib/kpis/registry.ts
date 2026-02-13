import type { KpiConfig } from './types';
import * as github from './fetchers/github';
import * as zendesk from './fetchers/zendesk';
import * as ossInsight from './fetchers/ossInsight';
import * as circleCI from './fetchers/circleCI';
import * as hibob from './fetchers/hibob';
import * as store from './fetchers/store';

export const kpiRegistry: KpiConfig[] = [
  // GitHub REST API KPIs
  {
    id: 'open-prs',
    title: 'Open PRs',
    description: 'Count of open, non-draft pull requests',
    unit: ' open PRs',
    thresholds: { warning: 50, problem: 75, lowerIsBetter: true },
    dataSource: 'github',
    fetch: async () => {
      'use server';
      return github.fetchOpenPRs('material-ui');
    },
  },
  {
    id: 'waiting-for-maintainer',
    title: 'Waiting for Maintainer',
    description: 'Issues waiting for maintainer response',
    unit: ' issues',
    thresholds: { warning: 25, problem: 50, lowerIsBetter: true },
    dataSource: 'github',
    fetch: async () => {
      'use server';
      return github.fetchWaitingForMaintainer('material-ui');
    },
  },
  {
    id: 'missing-github-label',
    title: 'Missing GitHub Label',
    description: 'Open issues and PRs without labels',
    unit: ' issues or PRs',
    thresholds: { warning: 1, problem: 10, lowerIsBetter: true },
    dataSource: 'github',
    fetch: async () => {
      'use server';
      return github.fetchMissingGitHubLabel();
    },
  },
  {
    id: 'head-ci-success-rate',
    title: 'Head CI Success Rate',
    description: 'CI success rate for the default branch',
    unit: '%',
    thresholds: { warning: 75, problem: 50, lowerIsBetter: false },
    dataSource: 'github',
    fetch: async () => {
      'use server';
      return github.fetchCommitStatuses('mui-x');
    },
  },

  // Zendesk API KPIs
  {
    id: 'zendesk-first-reply',
    title: 'Zendesk First Reply',
    description: 'Median time for first reply to support tickets',
    unit: ' hours',
    thresholds: { warning: 5, problem: 8, lowerIsBetter: true },
    dataSource: 'zendesk',
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
    dataSource: 'zendesk',
    fetch: async () => {
      'use server';
      return zendesk.fetchSatisfactionScore();
    },
  },

  // OSS Insight API KPIs
  {
    id: 'median-time-to-completion',
    title: 'Median Time to Completion',
    description: 'Median time for pull requests to be merged',
    unit: ' days',
    thresholds: { warning: 3, problem: 5, lowerIsBetter: true },
    dataSource: 'ossInsight',
    fetch: async () => {
      'use server';
      return ossInsight.fetchMedianTimeToCompletion('23083156');
    },
  },
  {
    id: 'issue-first-comment',
    title: 'Issue First Comment',
    description: 'Median time for first response to issues',
    unit: ' hours',
    thresholds: { warning: 8, problem: 24, lowerIsBetter: true },
    dataSource: 'ossInsight',
    fetch: async () => {
      'use server';
      return ossInsight.fetchIssueFirstComment('23083156');
    },
  },
  {
    id: 'closed-vs-opened-issues',
    title: 'Closed vs Opened Issues',
    description: 'Ratio of opened to closed issues over last 3 months',
    unit: ' ratio',
    thresholds: { warning: 2, problem: 2, lowerIsBetter: true },
    dataSource: 'ossInsight',
    fetch: async () => {
      'use server';
      return ossInsight.fetchClosedVsOpenedIssues('23083156');
    },
  },
  {
    id: 'community-contributors',
    title: 'Community Contributors',
    description: 'Ratio of community contributors to maintainers',
    unit: 'x',
    thresholds: { warning: 3, problem: 2, lowerIsBetter: false },
    dataSource: 'ossInsight',
    fetch: async () => {
      'use server';
      return ossInsight.fetchContributorsPerMonth('23083156');
    },
  },
  {
    id: 'community-prs',
    title: 'Community PRs',
    description: 'Ratio of community PRs to maintainer PRs',
    unit: '%',
    thresholds: { warning: 50, problem: 35, lowerIsBetter: false },
    dataSource: 'ossInsight',
    fetch: async () => {
      'use server';
      return ossInsight.fetchPrsPerMonth('23083156');
    },
  },

  // CircleCI API KPI
  {
    id: 'ci-completion-time',
    title: 'CI Completion Time',
    description: 'Median CI pipeline completion time',
    unit: ' minutes',
    thresholds: { warning: 15, problem: 20, lowerIsBetter: true },
    dataSource: 'circleCI',
    fetch: async () => {
      'use server';
      return circleCI.fetchCompletionTime('mui-x');
    },
  },

  // HiBob API KPIs
  {
    id: 'gender',
    title: 'Gender',
    description: 'Gender percentage across organization',
    unit: '%',
    thresholds: { warning: 30, problem: 15, lowerIsBetter: false },
    dataSource: 'hibob',
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
    dataSource: 'hibob',
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
    dataSource: 'hibob',
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
    dataSource: 'store',
    fetch: async () => {
      'use server';
      return store.fetchOverdueRatio();
    },
  },
];

export function getKpiById(id: string): KpiConfig | undefined {
  return kpiRegistry.find((kpi) => kpi.id === id);
}

export function getAllKpiIds(): string[] {
  return kpiRegistry.map((kpi) => kpi.id);
}
