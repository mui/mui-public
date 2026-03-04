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
