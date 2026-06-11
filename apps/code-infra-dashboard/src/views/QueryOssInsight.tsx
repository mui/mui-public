'use client';

import * as React from 'react';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
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
  fields: string[];
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
  // Search params seed the inputs so a link can pre-fill the editor. They are
  // only read here — the share link below is the explicit way to capture the
  // current input into a URL.
  const [searchParams] = useSearchParamsState({
    slug: { defaultValue: 'mui/material-ui' },
    sql: { defaultValue: '' },
  });

  const [slug, setSlug] = React.useState(searchParams.slug);
  const [sql, setSql] = React.useState(searchParams.sql);
  React.useEffect(() => setSlug(searchParams.slug), [searchParams.slug]);
  React.useEffect(() => setSql(searchParams.sql), [searchParams.sql]);

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

  // A permalink to the current input. Relative so the browser resolves it; as a
  // real anchor it supports cmd/middle-click to open in a new tab and
  // right-click to copy the address.
  const pathname = usePathname();
  const permalink = `${pathname}?${new URLSearchParams({ slug, sql })}`;

  const rows = React.useMemo(() => mutation.data?.rows ?? [], [mutation.data]);
  const fields = React.useMemo(() => mutation.data?.fields ?? [], [mutation.data]);

  const gridRows = React.useMemo(
    () => rows.map((row, index) => ({ ...row, [ROW_ID]: index })),
    [rows],
  );

  const columns = React.useMemo<GridColDef[]>(
    () => fields.map((field) => ({ field, flex: 1, minWidth: 120 })),
    [fields],
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
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          gap: 2,
          flex: 1,
          minHeight: 0,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            minHeight: 0,
            flexShrink: 0,
            width: { xs: '100%', md: 420 },
            height: { xs: '45%', md: 'auto' },
          }}
        >
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField
              size="small"
              label="Repository slug"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              sx={{ flex: 1 }}
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
            slotProps={{ htmlInput: { style: { fontFamily: 'monospace' } } }}
            sx={{
              flex: 1,
              minHeight: 0,
              '& .MuiInputBase-root': {
                height: '100%',
                alignItems: 'flex-start',
                overflow: 'auto',
              },
              '& .MuiInputBase-inputMultiline': { height: '100% !important' },
            }}
          />
          <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Button
              variant="contained"
              onClick={() => mutation.mutate()}
              loading={mutation.isPending}
              disabled={repositoryId === null || !sql.trim()}
            >
              Run query
            </Button>
            <Link component={NextLink} href={permalink} variant="body2">
              Permalink
            </Link>
          </Box>
          {mutation.isError ? (
            <ErrorDisplay title="Query failed" error={mutation.error as Error} />
          ) : null}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
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
    </Box>
  );
}
