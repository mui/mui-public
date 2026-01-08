export type KpiDataSourceType =
  | 'github'
  | 'zendesk'
  | 'ossInsight'
  | 'circleCI'
  | 'hibob'
  | 'store';

export interface KpiThresholds {
  warning: number;
  problem: number;
  lowerIsBetter: boolean;
}

export interface KpiConfig {
  id: string;
  title: string;
  description?: string;
  unit: string;
  thresholds: KpiThresholds;
  dataSource: KpiDataSourceType;
  fetch: () => Promise<KpiResult>;
}

export interface KpiResult {
  value: number | null;
  metadata?: string;
  error?: string;
}
