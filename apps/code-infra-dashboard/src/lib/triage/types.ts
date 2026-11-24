import type { GridColDef, GridSortModel } from '@mui/x-data-grid-premium';
import type { Repository } from '../../constants';

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
  createdAt?: Date;
}

export interface TriageViewConfig {
  id: TriageView;
  label: string;
  description: string;
  notionUrl?: string;
  columns: GridColDef<TriageRow>[];
  initialSortModel?: GridSortModel;
  /** Gets the private repositories the visitor may see, for the views that include them. */
  fetch: (privateRepos: Repository[]) => Promise<TriageRow[]>;
}
