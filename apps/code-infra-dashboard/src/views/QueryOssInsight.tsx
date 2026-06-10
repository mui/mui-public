'use client';

import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import NoSsr from '@mui/material/NoSsr';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { DataGridPremium, type GridColDef } from '@mui/x-data-grid-premium';
import Heading from '../components/Heading';
import ErrorDisplay from '../components/ErrorDisplay';
import { useSearchParamsState } from '../hooks/useSearchParamsState';
import { fetchJson } from '../utils/http';

interface RepoDetails {
  id: number;
}

type QueryRow = Record<string, unknown>;

// Injected on each grid row to give DataGrid a stable id; excluded from the
// generated columns since those derive from the raw query result keys.
const ROW_ID = '__rowIndex';

interface QueryResult {
  rows: QueryRow[];
}

async function runQuery(repositoryId: number, sql: string): Promise<QueryResult> {
  const response = await fetch('/api/oss-insight', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repositoryId, sql }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? `HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

export default function QueryOssInsight() {
  const [searchParams, setSearchParams] = useSearchParamsState(
    { slug: { defaultValue: 'mui/material-ui' } },
    { replace: true },
  );
  const { slug } = searchParams;

  const [sql, setSql] = React.useState('');

  const repoQuery = useQuery({
    queryKey: ['oss-insight-repo', slug],
    queryFn: () => fetchJson<RepoDetails>(`/api/oss-insight?${new URLSearchParams({ slug })}`),
    enabled: Boolean(slug),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const repositoryId = repoQuery.data?.id ?? null;

  const mutation = useMutation({
    mutationFn: () => runQuery(repositoryId!, sql),
  });

  const rows = React.useMemo(() => mutation.data?.rows ?? [], [mutation.data]);

  const gridRows = React.useMemo(
    () => rows.map((row, index) => ({ ...row, [ROW_ID]: index })),
    [rows],
  );

  const columns = React.useMemo<GridColDef[]>(
    () =>
      rows.length > 0
        ? Object.keys(rows[0]).map((field) => ({ field, flex: 1, minWidth: 120 }))
        : [],
    [rows],
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
      <Heading level={1}>Query OSS Insight</Heading>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
        Run arbitrary SQL against the{' '}
        <a href="https://ossinsight.io" target="_blank" rel="noreferrer">
          OSS Insight
        </a>{' '}
        playground for a GitHub repository.
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 2 }}>
        <TextField
          size="small"
          label="Repository slug"
          value={slug}
          onChange={(event) => setSearchParams({ slug: event.target.value })}
          sx={{ minWidth: 280 }}
        />
        <Typography variant="body2" color="text.secondary">
          {repositoryId !== null ? `Repository ID: ${repositoryId}` : 'Not found'}
        </Typography>
      </Box>
      <TextField
        label="SQL query"
        value={sql}
        onChange={(event) => setSql(event.target.value)}
        multiline
        minRows={4}
        fullWidth
        slotProps={{ htmlInput: { style: { fontFamily: 'monospace' } } }}
        sx={{ mb: 2 }}
      />
      <Box sx={{ mb: 2 }}>
        <Button
          variant="contained"
          onClick={() => mutation.mutate()}
          loading={mutation.isPending}
          disabled={repositoryId === null || !sql.trim()}
        >
          Run query
        </Button>
      </Box>
      {mutation.isError ? (
        <ErrorDisplay title="Query failed" error={mutation.error as Error} />
      ) : null}
      <Box sx={{ flex: 1, minHeight: 0, mt: 2 }}>
        {/* Remove <NoSsr> once https://github.com/mui/mui-x/issues/17077 is fixed */}
        <NoSsr>
          <DataGridPremium
            rows={gridRows}
            columns={columns}
            getRowId={(row) => row[ROW_ID] as number}
            loading={mutation.isPending}
            density="compact"
            disableRowSelectionOnClick
            sx={{ height: '100%' }}
          />
        </NoSsr>
      </Box>
    </Box>
  );
}
