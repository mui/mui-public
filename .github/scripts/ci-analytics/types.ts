export interface CiSnapshot {
  collectedAt: string;
  projects: ProjectMetrics[];
  orgCredits?: { week: number; month: number };
}

export interface ProjectMetrics {
  slug: string;
  displayName: string;
  workflows: WorkflowMetrics[];
  projectCredits: { week: number; month: number };
}

export interface WorkflowMetrics {
  name: string;
  week: PeriodSummary;
  month: PeriodSummary;
  allBranchCredits: { week: number; month: number };
}

export interface PeriodSummary {
  successRate: number;
  avgDurationSecs: number;
  avgSuccessDurationSecs: number;
  totalCredits: number;
  totalRuns: number;
}
