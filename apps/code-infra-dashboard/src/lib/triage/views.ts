import type { GridColDef } from '@mui/x-data-grid-premium';
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
    notionUrl:
      'https://www.notion.so/mui-org/KPIs-1ce9658b85ce4628a2a2ed2ae74ff69c?pvs=4#0231c2f8e6924c6d856b9dcda6af99c1',
    columns: [COL_NUMBER, COL_REPOSITORY, COL_TITLE, COL_STATE],
    fetch: fetchIssuesWithoutLabels,
  },
  {
    id: 'prs-without-labels',
    label: 'PRs without labels',
    description: 'Open non-draft PRs missing meaningful labels',
    notionUrl:
      'https://www.notion.so/mui-org/GitHub-community-issues-PRs-Tier-1-12a84fdf50e44595afc55343dac00fca#d97e5e8b4f394dec95de36668dbf81d2',
    columns: [COL_NUMBER, COL_REPOSITORY, COL_TITLE],
    fetch: fetchPrsWithoutLabels,
  },
  {
    id: 'prs-without-reviewer',
    label: 'PRs without reviewer',
    description: 'Open non-draft PRs with no reviews and no review requests',
    notionUrl:
      'https://www.notion.so/mui-org/GitHub-community-issues-PRs-Tier-1-12a84fdf50e44595afc55343dac00fca#c6b06804e0ac40c3aa2b5b5c16b202bf',
    columns: [COL_NUMBER, COL_REPOSITORY, COL_TITLE, COL_LABELS, COL_DAYS_AGO],
    fetch: fetchPrsWithoutReviewer,
  },
  {
    id: 'needs-triage-not-assigned',
    label: 'Needs triage, not assigned',
    description: 'Open issues labeled "waiting for maintainer" with no assignee',
    notionUrl:
      'https://www.notion.so/mui-org/GitHub-community-issues-PRs-Tier-1-12a84fdf50e44595afc55343dac00fca#8f5ae0daa6ad4543b866f3ad0532c9e4',
    columns: [COL_NUMBER, COL_REPOSITORY, COL_TITLE],
    fetch: fetchNeedsTriageNotAssigned,
  },
  {
    id: 'issues-without-product-scope',
    label: 'Issues without product scope',
    description: 'Issues with "waiting for maintainer" but only that one meaningful label',
    notionUrl:
      'https://www.notion.so/mui-org/GitHub-community-issues-PRs-12a84fdf50e44595afc55343dac00fca#d6680f5abf8b4e3ab132cb8e336bb5bc',
    columns: [COL_NUMBER, COL_STATE, COL_REPOSITORY, COL_TITLE],
    fetch: fetchIssuesWithoutProductScope,
  },
  {
    id: 'closed-issues-no-product-scope',
    label: 'Closed issues no product scope',
    description: 'Closed issues with "waiting for maintainer" across repos',
    notionUrl:
      'https://www.notion.so/mui-org/GitHub-community-issues-PRs-12a84fdf50e44595afc55343dac00fca#d6680f5abf8b4e3ab132cb8e336bb5bc',
    columns: [COL_NUMBER, COL_STATE, COL_REPOSITORY, COL_TITLE],
    fetch: fetchClosedIssuesNoProductScope,
  },
];

export function getTriageView(id: string): TriageViewConfig | undefined {
  return TRIAGE_VIEWS.find((view) => view.id === id);
}
