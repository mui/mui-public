export interface KpiThresholds {
  warning: number;
  problem: number;
  lowerIsBetter: boolean;
}

export interface KpiInfo {
  id: string;
  title: string;
  description?: string;
  unit: string;
  thresholds: KpiThresholds;
  group: string;
}

export type KpiConfig<TArgs extends unknown[] = []> = KpiInfo & {
  fetch: (...args: TArgs) => Promise<KpiResult>;
} & ([] extends TArgs ? { fetchParams?: TArgs } : { fetchParams: TArgs });

export interface KpiResult {
  value: number | null;
  metadata?: string;
  error?: string;
}
