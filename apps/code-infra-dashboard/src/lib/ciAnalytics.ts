export interface CiSnapshot {
  collectedAt: string;
  projects: ProjectMetrics[];
  orgCredits?: { week: number; month: number };
}

export interface ProjectMetrics {
  slug: string;
  displayName: string;
  workflows: WorkflowMetrics[];
  projectCredits?: { week: number; month: number };
}

export interface WorkflowMetrics {
  name: string;
  week: PeriodSummary;
  month: PeriodSummary;
  allBranchCredits?: { week: number; month: number };
}

export interface PeriodSummary {
  successRate: number;
  avgDurationSecs: number;
  avgSuccessDurationSecs: number;
  totalCredits: number;
  totalRuns: number;
}

const RAW_BASE = 'https://raw.githubusercontent.com/mui/mui-public/ci-data/ci-reports';

export function getSnapshotUrl(timestamp: string): string {
  return `${RAW_BASE}/${timestamp}.json`;
}

export async function fetchCiSnapshot(url: string): Promise<CiSnapshot> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch CI snapshot: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function fetchSnapshotIndex(): Promise<string[]> {
  const response = await fetch(
    'https://raw.githubusercontent.com/mui/mui-public/ci-data/index.json',
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch snapshot index: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

export function formatSuccessRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}
