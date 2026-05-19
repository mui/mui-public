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

export interface SnapshotIndexEntry {
  id: string;
  ts: number;
}

/**
 * Parses a snapshot timestamp string into a ms timestamp.
 * Snapshot timestamps use hyphens in the time part (e.g. "2026-03-17T10-04-25Z")
 * because they double as filenames and colons aren't filename-safe.
 */
function parseSnapshotTimestamp(timestamp: string): number {
  const normalized = timestamp.replace(/T(\d{2})-(\d{2})-(\d{2})Z/, 'T$1:$2:$3Z');
  return new Date(normalized).getTime();
}

export async function fetchSnapshotIndex(): Promise<SnapshotIndexEntry[]> {
  const response = await fetch(
    'https://raw.githubusercontent.com/mui/mui-public/ci-data/index.json',
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch snapshot index: ${response.status} ${response.statusText}`);
  }
  const raw: (string | SnapshotIndexEntry)[] = await response.json();
  return raw.map((entry) =>
    typeof entry === 'string' ? { id: entry, ts: parseSnapshotTimestamp(entry) } : entry,
  );
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
