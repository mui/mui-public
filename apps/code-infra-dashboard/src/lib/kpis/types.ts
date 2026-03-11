export interface KpiThresholds {
  warning: number;
  problem: number;
  lowerIsBetter: boolean;
}

export type KpiConfig<TArgs extends unknown[] = []> = {
  id: string;
  title: string;
  description?: string;
  unit: string;
  thresholds: KpiThresholds;
  group: string;
  fetch: (...args: TArgs) => Promise<KpiResult>;
} & ([] extends TArgs ? { fetchParams?: TArgs } : { fetchParams: TArgs });

export interface KpiResult {
  value: number | null;
  metadata?: string;
  error?: string;
}
