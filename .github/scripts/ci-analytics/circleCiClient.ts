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

// Serial request queue — each request waits for the previous one to finish
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

export interface OrgSummary {
  org_data: {
    metrics: {
      total_credits_used: number;
    };
  };
}

export async function fetchWorkflowCredits(
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

export async function fetchOrgSummary(
  orgSlug: string,
  reportingWindow: ReportingWindow,
): Promise<OrgSummary> {
  const path = `/insights/${orgSlug}/summary`;
  return fetchCircleCi<OrgSummary>(path, {
    'reporting-window': reportingWindow,
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
