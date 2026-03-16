import type { GridColDef } from '@mui/x-data-grid-premium';

export type TriageView =
  | 'issues-without-labels'
  | 'prs-without-labels'
  | 'prs-without-reviewer'
  | 'needs-triage-not-assigned'
  | 'issues-without-product-scope'
  | 'closed-issues-no-product-scope';

export interface TriageRow {
  id: number;
  number: number;
  title: string;
  url: string;
  repository: string;
  state?: string;
  labels?: string[];
  daysAgo?: number;
}

export interface TriageViewConfig {
  id: TriageView;
  label: string;
  description: string;
  columns: GridColDef<TriageRow>[];
  fetch: () => Promise<TriageRow[]>;
}
