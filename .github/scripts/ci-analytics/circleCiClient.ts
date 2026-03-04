const CIRCLECI_API_BASE = 'https://circleci.com/api/v2';

function getToken(): string {
  const token = process.env.CIRCLECI_TOKEN;
  if (!token) {
    throw new Error('CIRCLECI_TOKEN environment variable is required');
  }
  return token;
}

async function fetchCircleCi<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${CIRCLECI_API_BASE}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  console.warn(`GET ${url.pathname}${url.search}`);
  const response = await fetch(url.toString(), {
    headers: { 'Circle-Token': getToken() },
  });
  console.warn(`  -> ${response.status} ${response.statusText}`);

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`CircleCI API ${response.status}: ${response.statusText} - ${path}\n${body}`);
  }

  return response.json() as Promise<T>;
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

export interface WorkflowSummary {
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

export interface WorkflowRun {
  id: string;
  duration: number;
  status: string;
  created_at: string;
  stopped_at: string;
  credits_used: number;
  branch: string;
  is_approval: boolean;
}

export type ReportingWindow =
  | 'last-24-hours'
  | 'last-7-days'
  | 'last-30-days'
  | 'last-60-days'
  | 'last-90-days';

export async function fetchWorkflowSummary(
  slug: string,
  workflow: string,
  reportingWindow: ReportingWindow,
): Promise<WorkflowSummary> {
  const path = `/insights/${slug}/workflows/${workflow}/summary`;
  return fetchCircleCi<WorkflowSummary>(path, {
    'reporting-window': reportingWindow,
    branch: 'master',
  });
}

export async function fetchWorkflowRuns(
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
