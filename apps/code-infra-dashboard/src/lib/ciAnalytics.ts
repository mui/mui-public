export interface CiSnapshot {
  collectedAt: string;
  projects: ProjectMetrics[];
}

export interface ProjectMetrics {
  slug: string;
  displayName: string;
  workflows: WorkflowMetrics[];
}

export interface WorkflowMetrics {
  name: string;
  week: PeriodSummary;
  month: PeriodSummary;
  daily: DailyMetrics[];
}

export interface PeriodSummary {
  successRate: number;
  avgDurationSecs: number;
  totalCredits: number;
  totalRuns: number;
}

export interface DailyMetrics {
  date: string;
  successRate: number;
  avgDurationSecs: number;
  totalCredits: number;
  totalRuns: number;
}

const RAW_BASE = 'https://raw.githubusercontent.com/mui/mui-public/ci-data/ci-reports';

export async function fetchCiSnapshot(timestamp?: string): Promise<CiSnapshot> {
  const file = timestamp ? `${timestamp}.json` : 'latest.json';
  const response = await fetch(`${RAW_BASE}/${file}`);
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

export function getSuccessRateColor(rate: number): 'success' | 'warning' | 'error' {
  if (rate >= 0.95) {
    return 'success';
  }
  if (rate >= 0.8) {
    return 'warning';
  }
  return 'error';
}
