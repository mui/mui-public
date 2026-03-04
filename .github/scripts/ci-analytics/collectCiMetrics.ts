import { PROJECTS } from './projectConfig';
import { fetchWorkflowSummary, fetchWorkflowRuns, type WorkflowRun } from './circleCiClient';
import type {
  CiSnapshot,
  ProjectMetrics,
  WorkflowMetrics,
  PeriodSummary,
  DailyMetrics,
} from './types';

function toISODate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function computeDateRanges() {
  const now = new Date();
  const monthAgo = new Date(now);
  monthAgo.setDate(monthAgo.getDate() - 30);

  return {
    now,
    monthStart: monthAgo,
  };
}

function summaryFromApi(apiSummary: {
  metrics: {
    success_rate: number;
    duration_metrics: { mean: number };
    total_credits_used: number;
    total_runs: number;
  };
}): PeriodSummary {
  return {
    successRate: apiSummary.metrics.success_rate,
    avgDurationSecs: apiSummary.metrics.duration_metrics.mean,
    totalCredits: apiSummary.metrics.total_credits_used,
    totalRuns: apiSummary.metrics.total_runs,
  };
}

function aggregateRunsDaily(runs: WorkflowRun[]): DailyMetrics[] {
  const buckets = new Map<
    string,
    { totalDuration: number; successCount: number; totalCredits: number; totalRuns: number }
  >();

  for (const run of runs) {
    const date = toISODate(new Date(run.created_at));
    let bucket = buckets.get(date);
    if (!bucket) {
      bucket = { totalDuration: 0, successCount: 0, totalCredits: 0, totalRuns: 0 };
      buckets.set(date, bucket);
    }
    bucket.totalRuns += 1;
    bucket.totalDuration += run.duration;
    bucket.totalCredits += run.credits_used;
    if (run.status === 'success') {
      bucket.successCount += 1;
    }
  }

  return Array.from(buckets.entries())
    .map(([date, bucket]) => ({
      date,
      successRate: bucket.totalRuns > 0 ? bucket.successCount / bucket.totalRuns : 0,
      avgDurationSecs: bucket.totalRuns > 0 ? bucket.totalDuration / bucket.totalRuns : 0,
      totalCredits: bucket.totalCredits,
      totalRuns: bucket.totalRuns,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function collectWorkflowMetrics(
  slug: string,
  workflowName: string,
  monthStartISO: string,
  nowISO: string,
): Promise<WorkflowMetrics> {
  // Sequential requests to avoid CircleCI rate limits
  const weekSummary = await fetchWorkflowSummary(slug, workflowName, 'last-7-days');
  const monthSummary = await fetchWorkflowSummary(slug, workflowName, 'last-30-days');
  const runs = await fetchWorkflowRuns(slug, workflowName, monthStartISO, nowISO);

  return {
    name: workflowName,
    week: summaryFromApi(weekSummary),
    month: summaryFromApi(monthSummary),
    daily: aggregateRunsDaily(runs),
  };
}

async function collectProjectMetrics(
  project: (typeof PROJECTS)[number],
  monthStartISO: string,
  nowISO: string,
): Promise<ProjectMetrics> {
  const workflows: WorkflowMetrics[] = [];
  for (const wf of project.workflows) {
    // eslint-disable-next-line no-await-in-loop -- Sequential to avoid CircleCI rate limits
    workflows.push(await collectWorkflowMetrics(project.slug, wf, monthStartISO, nowISO));
  }

  return {
    slug: project.slug,
    displayName: project.displayName,
    workflows,
  };
}

async function main() {
  const { now, monthStart } = computeDateRanges();
  const nowISO = now.toISOString();
  const monthStartISO = monthStart.toISOString();

  // Process projects sequentially to avoid CircleCI API rate limits
  const projects: ProjectMetrics[] = [];
  for (const project of PROJECTS) {
    console.warn(`Collecting metrics for ${project.displayName}...`);
    // eslint-disable-next-line no-await-in-loop -- Sequential to avoid CircleCI rate limits
    projects.push(await collectProjectMetrics(project, monthStartISO, nowISO));
  }

  const snapshot: CiSnapshot = {
    collectedAt: nowISO,
    projects,
  };

  process.stdout.write(JSON.stringify(snapshot, null, 2));
}

main().catch((error) => {
  console.error('Failed to collect CI metrics:', error);
  process.exit(1);
});
