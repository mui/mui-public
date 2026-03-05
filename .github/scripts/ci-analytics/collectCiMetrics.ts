import { PROJECTS } from './projectConfig';
import {
  fetchWorkflowRuns,
  fetchWorkflowCredits,
  fetchOrgSummary,
  fetchProjectWorkflowsSummary,
  type WorkflowRun,
  type WorkflowSummary,
} from './circleCiClient';
import type { CiSnapshot, ProjectMetrics, WorkflowMetrics, PeriodSummary } from './types';

function computeDateRanges() {
  const now = new Date();
  const monthAgo = new Date(now);
  monthAgo.setDate(monthAgo.getDate() - 30);

  return {
    now,
    monthStart: monthAgo,
  };
}

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
  project: (typeof PROJECTS)[number],
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

async function main() {
  const { now, monthStart } = computeDateRanges();
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

  const snapshot: CiSnapshot = {
    collectedAt: nowISO,
    projects,
    orgCredits: {
      week: orgWeek.org_data.metrics.total_credits_used,
      month: orgMonth.org_data.metrics.total_credits_used,
    },
  };

  process.stdout.write(JSON.stringify(snapshot, null, 2));
}

main().catch((error) => {
  console.error('Failed to collect CI metrics:', error);
  process.exit(1);
});
