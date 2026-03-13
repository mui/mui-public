'use client';

import * as React from 'react';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Link from '@mui/material/Link';
import { DataGridPro, type GridColDef } from '@mui/x-data-grid-pro';
import { useSearchParamsState } from '../hooks/useSearchParamsState';
import { useTriageData } from '../hooks/useTriageData';
import { TRIAGE_VIEWS, getTriageView } from '../lib/triage/views';
import type { TriageRow, TriageView as TriageViewId } from '../lib/triage/types';
import Heading from '../components/Heading';
import ErrorDisplay from '../components/ErrorDisplay';

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

function getColumns(viewColumns: GridColDef<TriageRow>[]): GridColDef<TriageRow>[] {
  return viewColumns.map((col) => {
    if (col.field === 'title') {
      return { ...col, ...TITLE_COLUMN };
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

  return (
    <Box sx={{ mt: 4 }}>
      <Heading level={1}>GitHub Triage</Heading>

      <TextField
        select
        label="View"
        value={activeView.id}
        onChange={(event) => setParams({ view: event.target.value as TriageViewId })}
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
      </Typography>

      {error ? (
        <ErrorDisplay title="Failed to load triage data" error={error} />
      ) : (
        <DataGridPro
          rows={rows}
          columns={columns}
          loading={isLoading}
          density="compact"
          autoHeight
          pagination
          initialState={{
            pagination: { paginationModel: { pageSize: 25 } },
          }}
          pageSizeOptions={[25, 50, 100]}
          disableRowSelectionOnClick
        />
      )}
    </Box>
  );
}
