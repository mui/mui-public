import type { CiSnapshot, ProjectMetrics, WorkflowMetrics, PeriodSummary } from './ciAnalytics';

// --- Project config ---

interface ProjectConfig {
  slug: string;
  displayName: string;
  workflows: string[];
}

const PROJECTS: ProjectConfig[] = [
  { slug: 'gh/mui/mui-public', displayName: 'Code infra', workflows: ['pipeline'] },
  { slug: 'gh/mui/mui-private', displayName: 'MUI Private', workflows: ['pipeline'] },
  { slug: 'gh/mui/material-ui', displayName: 'MUI Core', workflows: ['pipeline'] },
  { slug: 'gh/mui/base-ui', displayName: 'Base UI', workflows: ['pipeline', 'react-18'] },
  { slug: 'gh/mui/mui-x', displayName: 'MUI X', workflows: ['pipeline'] },
];

// --- CircleCI API client ---

const CIRCLECI_API_BASE = 'https://circleci.com/api/v2';
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function getToken(): string {
  const token = process.env.CIRCLECI_TOKEN;
  if (!token) {
    throw new Error('CIRCLECI_TOKEN environment variable is required');
  }
  return token;
}

let queueTail: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const result = queueTail.then(fn, fn);
  queueTail = result.then(
    () => {},
    () => {},
  );
  return result;
}

async function fetchCircleCiDirect<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${CIRCLECI_API_BASE}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    console.warn(`GET ${url.pathname}${url.search}`);
    // eslint-disable-next-line no-await-in-loop -- retry loop
    const response = await fetch(url.toString(), {
      headers: { 'Circle-Token': getToken() },
    });
    console.warn(`  -> ${response.status} ${response.statusText}`);

    if (response.status === 429 && attempt < MAX_RETRIES) {
      const delay = BASE_DELAY_MS * 2 ** attempt;
      console.warn(
        `  Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
      );
      // eslint-disable-next-line no-await-in-loop -- retry loop
      await new Promise((resolve) => {
        setTimeout(resolve, delay);
      });
      continue;
    }

    if (!response.ok) {
      // eslint-disable-next-line no-await-in-loop -- retry loop
      const body = await response.text().catch(() => '');
      throw new Error(`CircleCI API ${response.status}: ${response.statusText} - ${path}\n${body}`);
    }

    // eslint-disable-next-line no-await-in-loop -- retry loop
    return (await response.json()) as T;
  }

  throw new Error(`CircleCI API: max retries exceeded for ${path}`);
}

function fetchCircleCi<T>(path: string, params?: Record<string, string>): Promise<T> {
  return enqueue(() => fetchCircleCiDirect<T>(path, params));
}

interface PaginatedResponse<T> {
  items: T[];
  next_page_token: string | null;
}

async function fetchAllPages<T>(path: string, params?: Record<string, string>): Promise<T[]> {
  const items: T[] = [];
  let pageToken: string | null = null;

  do {
    const queryParams = { ...params };
    if (pageToken) {
      queryParams['page-token'] = pageToken;
    }

    // eslint-disable-next-line no-await-in-loop -- Sequential pagination required
    const response = await fetchCircleCi<PaginatedResponse<T>>(path, queryParams);
    items.push(...response.items);
    pageToken = response.next_page_token;
  } while (pageToken);

  return items;
}

// --- CircleCI API types ---

interface WorkflowSummary {
  metrics: {
    total_runs: number;
    successful_runs: number;
    failed_runs: number;
    success_rate: number;
    duration_metrics: {
      min: number;
      mean: number;
      median: number;
      p95: number;
      max: number;
      total_duration: number;
    };
    total_credits_used: number;
    throughput: number;
  };
  trends: Record<string, unknown>;
  name: string;
}

interface WorkflowRun {
  id: string;
  duration: number;
  status: string;
  created_at: string;
  stopped_at: string;
  credits_used: number;
  branch: string;
  is_approval: boolean;
}

type ReportingWindow =
  | 'last-24-hours'
  | 'last-7-days'
  | 'last-30-days'
  | 'last-60-days'
  | 'last-90-days';

interface OrgSummary {
  org_data: {
    metrics: {
      total_credits_used: number;
    };
  };
}

// --- CircleCI API functions ---

function fetchWorkflowCredits(
  slug: string,
  workflow: string,
  reportingWindow: ReportingWindow,
): Promise<WorkflowSummary> {
  const path = `/insights/${slug}/workflows/${workflow}/summary`;
  return fetchCircleCi<WorkflowSummary>(path, {
    'reporting-window': reportingWindow,
    'all-branches': 'true',
  });
}

function fetchProjectWorkflowsSummary(
  slug: string,
  reportingWindow: ReportingWindow,
): Promise<WorkflowSummary[]> {
  const path = `/insights/${slug}/workflows`;
  return fetchAllPages<WorkflowSummary>(path, {
    'reporting-window': reportingWindow,
    'all-branches': 'true',
  });
}

function fetchOrgSummary(orgSlug: string, reportingWindow: ReportingWindow): Promise<OrgSummary> {
  const path = `/insights/${orgSlug}/summary`;
  return fetchCircleCi<OrgSummary>(path, {
    'reporting-window': reportingWindow,
  });
}

function fetchWorkflowRuns(
  slug: string,
  workflow: string,
  startDate: string,
  endDate: string,
): Promise<WorkflowRun[]> {
  const path = `/insights/${slug}/workflows/${workflow}`;
  return fetchAllPages<WorkflowRun>(path, {
    'start-date': startDate,
    'end-date': endDate,
    branch: 'master',
  });
}

// --- Collection logic ---

function summarizeRuns(runs: WorkflowRun[]): PeriodSummary {
  let totalDuration = 0;
  let successDuration = 0;
  let successCount = 0;
  let totalCredits = 0;

  for (const run of runs) {
    totalDuration += run.duration;
    totalCredits += run.credits_used;
    if (run.status === 'success') {
      successCount += 1;
      successDuration += run.duration;
    }
  }

  return {
    successRate: runs.length > 0 ? successCount / runs.length : 0,
    avgDurationSecs: runs.length > 0 ? totalDuration / runs.length : 0,
    avgSuccessDurationSecs: successCount > 0 ? successDuration / successCount : 0,
    totalCredits,
    totalRuns: runs.length,
  };
}

async function collectWorkflowMetrics(
  slug: string,
  workflowName: string,
  monthStartISO: string,
  nowISO: string,
): Promise<WorkflowMetrics> {
  const [runs, creditsWeek, creditsMonth] = await Promise.all([
    fetchWorkflowRuns(slug, workflowName, monthStartISO, nowISO),
    fetchWorkflowCredits(slug, workflowName, 'last-7-days'),
    fetchWorkflowCredits(slug, workflowName, 'last-30-days'),
  ]);

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekRuns = runs.filter((r) => new Date(r.created_at) >= weekAgo);

  return {
    name: workflowName,
    week: summarizeRuns(weekRuns),
    month: summarizeRuns(runs),
    allBranchCredits: {
      week: creditsWeek.metrics.total_credits_used,
      month: creditsMonth.metrics.total_credits_used,
    },
  };
}

async function collectProjectMetrics(
  project: ProjectConfig,
  monthStartISO: string,
  nowISO: string,
): Promise<ProjectMetrics> {
  const [workflows, allWfWeek, allWfMonth] = await Promise.all([
    Promise.all(
      project.workflows.map((wf) =>
        collectWorkflowMetrics(project.slug, wf, monthStartISO, nowISO),
      ),
    ),
    fetchProjectWorkflowsSummary(project.slug, 'last-7-days'),
    fetchProjectWorkflowsSummary(project.slug, 'last-30-days'),
  ]);

  const sumCredits = (wfs: WorkflowSummary[]) =>
    wfs.reduce((sum, wf) => sum + wf.metrics.total_credits_used, 0);

  return {
    slug: project.slug,
    displayName: project.displayName,
    workflows,
    projectCredits: { week: sumCredits(allWfWeek), month: sumCredits(allWfMonth) },
  };
}

export async function collectCiSnapshot(): Promise<CiSnapshot> {
  const now = new Date();
  const monthStart = new Date(now);
  monthStart.setDate(monthStart.getDate() - 30);

  const nowISO = now.toISOString();
  const monthStartISO = monthStart.toISOString();

  const projects = await Promise.all(
    PROJECTS.map((project) => {
      console.warn(`Collecting metrics for ${project.displayName}...`);
      return collectProjectMetrics(project, monthStartISO, nowISO);
    }),
  );

  const [orgWeek, orgMonth] = await Promise.all([
    fetchOrgSummary('gh/mui', 'last-7-days'),
    fetchOrgSummary('gh/mui', 'last-30-days'),
  ]);

  return {
    collectedAt: nowISO,
    projects,
    orgCredits: {
      week: orgWeek.org_data.metrics.total_credits_used,
      month: orgMonth.org_data.metrics.total_credits_used,
    },
  };
}
