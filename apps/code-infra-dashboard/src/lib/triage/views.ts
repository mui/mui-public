import type { GridColDef } from '@mui/x-data-grid-pro';
import type { TriageRow, TriageViewConfig } from './types';
import {
  fetchIssuesWithoutLabels,
  fetchPrsWithoutLabels,
  fetchPrsWithoutReviewer,
  fetchNeedsTriageNotAssigned,
  fetchIssuesWithoutProductScope,
  fetchClosedIssuesNoProductScope,
} from './fetchers';

const COL_NUMBER: GridColDef<TriageRow> = {
  field: 'number',
  headerName: '#',
  width: 80,
};

const COL_REPOSITORY: GridColDef<TriageRow> = {
  field: 'repository',
  headerName: 'Repository',
  width: 140,
};

const COL_TITLE: GridColDef<TriageRow> = {
  field: 'title',
  headerName: 'Title',
  flex: 1,
  minWidth: 200,
};

const COL_STATE: GridColDef<TriageRow> = {
  field: 'state',
  headerName: 'State',
  width: 90,
};

const COL_LABELS: GridColDef<TriageRow> = {
  field: 'labels',
  headerName: 'Labels',
  width: 250,
  valueFormatter: (value: string[] | undefined) => (value ? value.join(', ') : ''),
};

const COL_DAYS_AGO: GridColDef<TriageRow> = {
  field: 'daysAgo',
  headerName: 'Age (days)',
  width: 100,
  type: 'number',
};

export const TRIAGE_VIEWS: TriageViewConfig[] = [
  {
    id: 'issues-without-labels',
    label: 'Issues without labels',
    description: 'Open + closed issues with no labels across all MUI repos',
    columns: [COL_NUMBER, COL_REPOSITORY, COL_TITLE, COL_STATE],
    fetch: fetchIssuesWithoutLabels,
  },
  {
    id: 'prs-without-labels',
    label: 'PRs without labels',
    description: 'Open non-draft PRs missing meaningful labels',
    columns: [COL_NUMBER, COL_REPOSITORY, COL_TITLE],
    fetch: fetchPrsWithoutLabels,
  },
  {
    id: 'prs-without-reviewer',
    label: 'PRs without reviewer',
    description: 'Open non-draft PRs with no reviews and no review requests',
    columns: [COL_NUMBER, COL_REPOSITORY, COL_TITLE, COL_LABELS, COL_DAYS_AGO],
    fetch: fetchPrsWithoutReviewer,
  },
  {
    id: 'needs-triage-not-assigned',
    label: 'Needs triage, not assigned',
    description: 'Open issues labeled "waiting for maintainer" with no assignee',
    columns: [COL_NUMBER, COL_REPOSITORY, COL_TITLE],
    fetch: fetchNeedsTriageNotAssigned,
  },
  {
    id: 'issues-without-product-scope',
    label: 'Issues without product scope',
    description: 'Issues with "waiting for maintainer" but only that one meaningful label',
    columns: [COL_NUMBER, COL_STATE, COL_REPOSITORY, COL_TITLE],
    fetch: fetchIssuesWithoutProductScope,
  },
  {
    id: 'closed-issues-no-product-scope',
    label: 'Closed issues no product scope',
    description: 'Closed issues with "waiting for maintainer" across repos',
    columns: [COL_NUMBER, COL_STATE, COL_REPOSITORY, COL_TITLE],
    fetch: fetchClosedIssuesNoProductScope,
  },
];

export function getTriageView(id: string): TriageViewConfig | undefined {
  return TRIAGE_VIEWS.find((view) => view.id === id);
}
