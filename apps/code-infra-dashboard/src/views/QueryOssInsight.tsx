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
import { styled } from '@mui/material/styles';
import { DataGridPremium } from '@mui/x-data-grid-premium';
import type { GridColDef } from '@mui/x-data-grid-premium';
import Heading from '../components/Heading';
import ErrorDisplay from '../components/ErrorDisplay';
import { useSearchParamsState } from '../hooks/useSearchParamsState';
import { fetchJson } from '../utils/http';

// A native textarea takes a fixed height and scrolls instead of autosizing to
// its content like MUI's multiline TextField — which is what a query editor
// that fills the pane needs. Colors come from theme.vars so it tracks the
// active color scheme (light/dark).
const SqlEditor = styled('textarea')(({ theme }) => ({
  flex: 1,
  minHeight: 0,
  width: '100%',
  boxSizing: 'border-box',
  resize: 'none',
  padding: theme.spacing(1.5),
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: theme.typography.pxToRem(13),
  lineHeight: 1.5,
  color: theme.vars.palette.text.primary,
  backgroundColor: theme.vars.palette.background.paper,
  border: `1px solid ${theme.vars.palette.divider}`,
  borderRadius: theme.shape.borderRadius,
  outline: 'none',
  '&:hover': { borderColor: theme.vars.palette.text.primary },
  '&:focus': {
    borderColor: theme.vars.palette.primary.main,
    borderWidth: 2,
    padding: `calc(${theme.spacing(1.5)} - 1px)`,
  },
  '&::placeholder': { color: theme.vars.palette.text.disabled },
}));

interface RepoDetails {
  id: number;
}

type QueryRow = Record<string, unknown>;

// Injected on each grid row to give DataGrid a stable id; excluded from the
// generated columns since those derive from the raw query result keys.
const ROW_ID = '__rowIndex';

const getRowId = (row: QueryRow) => row[ROW_ID] as number;

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

  // Re-seed the drafts when the URL changes (initial hydration, or navigating a
  // permalink). Adjusting state during render is React's recommended
  // alternative to syncing with a setState-in-effect.
  const [seededFrom, setSeededFrom] = React.useState(searchParams);
  if (seededFrom.slug !== searchParams.slug || seededFrom.sql !== searchParams.sql) {
    setSeededFrom(searchParams);
    setSlug(searchParams.slug);
    setSql(searchParams.sql);
  }

  const repoQuery = useQuery({
    queryKey: ['oss-insight-repo', slug],
    queryFn: () => fetchJson<RepoDetails>(`/api/oss-insight?${new URLSearchParams({ slug })}`),
    enabled: Boolean(slug),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const repositoryId = repoQuery.data?.id ?? null;

  let repoStatus = '';
  if (repoQuery.isLoading) {
    repoStatus = 'Looking up…';
  } else if (repositoryId !== null) {
    repoStatus = `Repository ID: ${repositoryId}`;
  }

  const mutation = useMutation({
    mutationFn: () => runQuery(repositoryId!, sql),
  });

  // A permalink to the current input. Relative so the browser resolves it; as a
  // real anchor it supports cmd/middle-click to open in a new tab and
  // right-click to copy the address.
  const pathname = usePathname();
  const permalink = `${pathname}?${new URLSearchParams({ slug, sql })}`;

  const { rows, fields } = React.useMemo(
    () => ({ rows: mutation.data?.rows ?? [], fields: mutation.data?.fields ?? [] }),
    [mutation.data],
  );

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
              {repoStatus}
            </Typography>
          </Box>
          {repoQuery.isError ? (
            <ErrorDisplay title="Repository lookup failed" error={repoQuery.error as Error} />
          ) : null}
          <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Typography
              variant="caption"
              component="label"
              htmlFor="sql-query"
              color="text.secondary"
            >
              SQL query
            </Typography>
            <SqlEditor
              id="sql-query"
              value={sql}
              onChange={(event) => setSql(event.target.value)}
              placeholder="SELECT ..."
              spellCheck={false}
            />
          </Box>
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
              getRowId={getRowId}
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
