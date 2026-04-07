'use client';

import * as React from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Link from '@mui/material/Link';
import {
  DataGridPremium,
  useGridApiRef,
  useKeepGroupedColumnsHidden,
  type GridColDef,
} from '@mui/x-data-grid-premium';
import { useSearchParamsState } from '../hooks/useSearchParamsState';
import { useTriageData } from '../hooks/useTriageData';
import { TRIAGE_VIEWS, getTriageView } from '../lib/triage/views';
import type { TriageRow, TriageView as TriageViewId } from '../lib/triage/types';
import Heading from '../components/Heading';
import ErrorDisplay from '../components/ErrorDisplay';

const STATE_COLORS: Record<string, string> = {
  open: '#238636',
  closed: '#8957e5',
};

const TITLE_COLUMN: GridColDef<TriageRow> = {
  field: 'title',
  headerName: 'Title',
  flex: 1,
  minWidth: 200,
  renderCell: (params) => (
    <Link href={params.row.url} target="_blank" rel="noopener noreferrer" underline="hover">
      {params.value}
    </Link>
  ),
};

const STATE_COLUMN: GridColDef<TriageRow> = {
  field: 'state',
  headerName: 'State',
  width: 90,
  renderCell: (params) => {
    const state = params.value as string | undefined;
    if (!state) {
      return null;
    }
    const color = STATE_COLORS[state] ?? '#656d76';
    return (
      <Chip label={state} size="small" sx={{ bgcolor: color, color: '#fff', fontWeight: 500 }} />
    );
  },
};

function getColumns(viewColumns: GridColDef<TriageRow>[]): GridColDef<TriageRow>[] {
  return viewColumns.map((col) => {
    if (col.field === 'title') {
      return { ...col, ...TITLE_COLUMN };
    }
    if (col.field === 'state') {
      return { ...col, ...STATE_COLUMN };
    }
    return col;
  });
}

export default function GitHubTriage() {
  const [params, setParams] = useSearchParamsState(
    {
      view: { defaultValue: TRIAGE_VIEWS[0].id },
    },
    { replace: true },
  );

  const activeViewId = params.view as TriageViewId;
  const activeView = getTriageView(activeViewId) ?? TRIAGE_VIEWS[0];
  const { rows, isLoading, error } = useTriageData(activeView.id);

  const columns = React.useMemo(() => getColumns(activeView.columns), [activeView.columns]);

  const apiRef = useGridApiRef();
  const rowGroupingModel = React.useMemo(() => ['repository'], []);
  const groupingState = useKeepGroupedColumnsHidden({
    apiRef,
    rowGroupingModel,
  });

  const initialState = React.useMemo(
    () => ({
      ...groupingState,
      sorting: {
        sortModel: activeView.initialSortModel ?? [],
      },
    }),
    [groupingState, activeView.initialSortModel],
  );

  return (
    <Box
      sx={{
        mt: 4,
        height: 'calc(100dvh - 120px)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <Heading level={1}>GitHub Triage</Heading>

      <TextField
        select
        label="View"
        value={activeView.id}
        onChange={(event) => setParams({ view: event.target.value as TriageViewId })}
        size="small"
        sx={{ mt: 2, minWidth: 300 }}
      >
        {TRIAGE_VIEWS.map((view) => (
          <MenuItem key={view.id} value={view.id}>
            {view.label}
          </MenuItem>
        ))}
      </TextField>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
        {activeView.description}
        {activeView.notionUrl ? (
          <React.Fragment>
            {' - '}
            <Link href={activeView.notionUrl} target="_blank" rel="noopener noreferrer">
              Notion
            </Link>
          </React.Fragment>
        ) : null}
      </Typography>

      {error ? (
        <ErrorDisplay title="Failed to load triage data" error={error} />
      ) : (
        <DataGridPremium
          apiRef={apiRef}
          rows={rows}
          columns={columns}
          loading={isLoading}
          density="compact"
          sx={{
            flex: 1,
            minHeight: 0,
            // Failsafe in case a query returns an unexpectedly large number of rows
            maxHeight: '100vh',
          }}
          disableRowSelectionOnClick
          initialState={initialState}
          rowGroupingModel={rowGroupingModel}
          defaultGroupingExpansionDepth={-1}
          groupingColDef={{ headerName: 'Repository' }}
        />
      )}
    </Box>
  );
}
