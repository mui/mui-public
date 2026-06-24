'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import NextLink from 'next/link';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import NoSsr from '@mui/material/NoSsr';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  DataGridPremium,
  useGridApiRef,
  useKeepGroupedColumnsHidden,
} from '@mui/x-data-grid-premium';
import type { GridColDef } from '@mui/x-data-grid-premium';
import { LineChart } from '@mui/x-charts-pro/LineChart';
import Heading from '../components/Heading';
import ErrorDisplay from '../components/ErrorDisplay';
import { useSearchParamsState } from '../hooks/useSearchParamsState';
import { octokit, parseIssueUrl } from '../utils/github';
import type { IssueReactionTarget } from '../utils/github';

const EXAMPLES = [
  { label: 'mui-design-kits#10', url: 'https://github.com/mui/mui-design-kits/issues/10' },
  { label: 'mui-design-kits#111', url: 'https://github.com/mui/mui-design-kits/issues/111' },
].map((example) => ({
  ...example,
  href: `/reactions?${new URLSearchParams({ url: example.url })}`,
}));

const EMOJI: Record<string, string> = {
  '+1': '👍',
  '-1': '👎',
  laugh: '😄',
  confused: '😕',
  heart: '❤️',
  hooray: '🎉',
  rocket: '🚀',
  eyes: '👀',
};

const DATE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const MONTH_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

interface ReactionRow {
  id: number;
  content: string;
  user: string;
  userUrl: string;
  createdAt: string;
}

interface ReactionsResult {
  rows: ReactionRow[];
  truncated: boolean;
}

const MAX_PAGES = 3;
const PAGE_SIZE = 100;

async function fetchReactions(
  target: IssueReactionTarget,
  unbounded: boolean,
): Promise<ReactionsResult> {
  const iterator = octokit.paginate.iterator(octokit.rest.reactions.listForIssue, {
    owner: target.owner,
    repo: target.repo,
    issue_number: target.number,
    per_page: PAGE_SIZE,
  });

  const rows: ReactionRow[] = [];
  let pages = 0;
  let truncated = false;
  for await (const response of iterator) {
    pages += 1;
    for (const reaction of response.data) {
      rows.push({
        id: reaction.id,
        content: reaction.content,
        user: reaction.user?.login ?? '(unknown)',
        userUrl: reaction.user?.html_url ?? '',
        createdAt: reaction.created_at,
      });
    }
    if (!unbounded && pages >= MAX_PAGES && response.data.length === PAGE_SIZE) {
      truncated = true;
      break;
    }
  }

  return { rows, truncated };
}

const COLUMNS: GridColDef<ReactionRow>[] = [
  {
    field: 'content',
    headerName: 'Reaction',
    width: 140,
    valueFormatter: (value: string) => `${EMOJI[value] ?? ''} ${value}`.trim(),
  },
  {
    field: 'createdAt',
    headerName: 'Created at',
    type: 'dateTime',
    width: 140,
    valueGetter: (value: string) => (value ? new Date(value) : null),
    valueFormatter: (value: Date | null) => (value ? DATE_TIME_FORMAT.format(value) : ''),
  },
  {
    field: 'user',
    headerName: 'User',
    flex: 1,
    minWidth: 200,
    renderCell: (cellParams) =>
      cellParams.row.userUrl ? (
        <Link href={cellParams.row.userUrl} target="_blank" underline="hover">
          @{cellParams.value}
        </Link>
      ) : (
        cellParams.value
      ),
  },
];

function targetKey(target: IssueReactionTarget): string {
  return `${target.owner}/${target.repo}#${target.number}`;
}

interface MonthlyBucket {
  month: Date;
  count: number;
}

// Number of months since year 0, used to bucket and iterate over months in UTC.
function monthIndex(date: Date): number {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

function computeMonthlyBuckets(rows: ReactionRow[]): MonthlyBucket[] {
  if (rows.length === 0) {
    return [];
  }
  const counts = new Map<number, number>();
  let min = Infinity;
  let max = -Infinity;
  for (const row of rows) {
    const index = monthIndex(new Date(row.createdAt));
    min = Math.min(min, index);
    max = Math.max(max, index);
    counts.set(index, (counts.get(index) ?? 0) + 1);
  }
  const buckets: MonthlyBucket[] = [];
  for (let index = min; index <= max; index += 1) {
    const month = new Date(Date.UTC(Math.floor(index / 12), index % 12, 1));
    buckets.push({ month, count: counts.get(index) ?? 0 });
  }
  return buckets;
}

export default function Reactions() {
  const [searchParams, setSearchParams] = useSearchParamsState(
    { url: { defaultValue: '' }, all: { defaultValue: '' } },
    { replace: true },
  );

  const unbounded = searchParams.all === '1';
  const loadAllHref = `/reactions?${new URLSearchParams({ url: searchParams.url, all: '1' })}`;

  const [draft, setDraft] = React.useState(searchParams.url);
  const [prevUrl, setPrevUrl] = React.useState(searchParams.url);
  if (searchParams.url !== prevUrl) {
    setPrevUrl(searchParams.url);
    setDraft(searchParams.url);
  }

  const target = React.useMemo(
    () => (searchParams.url ? parseIssueUrl(searchParams.url) : null),
    [searchParams.url],
  );
  const parseError = Boolean(searchParams.url) && target === null;

  const query = useQuery({
    queryKey: ['reactions', target ? targetKey(target) : null, unbounded],
    queryFn: () => fetchReactions(target!, unbounded),
    enabled: Boolean(target),
    staleTime: 60 * 1000,
    retry: false,
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setSearchParams({ url: draft.trim(), all: '' });
  };

  const monthlyBuckets = React.useMemo(
    () => computeMonthlyBuckets(query.data?.rows ?? []),
    [query.data?.rows],
  );

  const apiRef = useGridApiRef();
  const rowGroupingModel = React.useMemo(() => ['content'], []);
  const initialState = useKeepGroupedColumnsHidden({ apiRef, rowGroupingModel });

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
      <Heading level={1}>GitHub reactions</Heading>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
        Paste a public GitHub issue or pull request URL to list every reaction and the users who
        left them. Only public repositories are supported. Examples:{' '}
        {EXAMPLES.map((example, index) => (
          <React.Fragment key={example.url}>
            {index > 0 ? ', ' : null}
            <Link component={NextLink} href={example.href}>
              {example.label}
            </Link>
          </React.Fragment>
        ))}
      </Typography>
      <Box
        component="form"
        onSubmit={handleSubmit}
        sx={{ mb: 2, display: 'flex', gap: 1, alignItems: 'center' }}
      >
        <TextField
          fullWidth
          size="small"
          label="GitHub URL"
          placeholder="https://github.com/owner/repo/issues/123"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button
          type="submit"
          variant="contained"
          disabled={!draft.trim() || draft.trim() === searchParams.url}
        >
          Load
        </Button>
      </Box>
      {parseError ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Not a recognized GitHub URL. Expected an issue or pull request link.
        </Alert>
      ) : null}
      {query.data?.truncated ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          Showing the first {MAX_PAGES * PAGE_SIZE} reactions. This issue has more —{' '}
          <Link component={NextLink} href={loadAllHref}>
            load all reactions
          </Link>
          . This will use more of your hourly GitHub API budget.
        </Alert>
      ) : null}
      {query.isError ? (
        <ErrorDisplay title="Failed to load reactions" error={query.error as Error} />
      ) : null}
      <Box sx={{ height: 220, mb: 2 }}>
        <LineChart
          xAxis={[
            {
              scaleType: 'time',
              data: monthlyBuckets.map((bucket) => bucket.month),
              valueFormatter: (value: Date) => MONTH_FORMAT.format(value),
            },
          ]}
          series={[
            {
              data: monthlyBuckets.map((bucket) => bucket.count),
              label: 'Reactions',
              showMark: true,
            },
          ]}
          margin={{ top: 16, right: 16, bottom: 24, left: 40 }}
          hideLegend
          skipAnimation
        />
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, maxHeight: '100vh' }}>
        {/* Remove <NoSsr> once https://github.com/mui/mui-x/issues/17077 is fixed */}
        <NoSsr>
          <DataGridPremium
            apiRef={apiRef}
            rows={query.data?.rows ?? []}
            columns={COLUMNS}
            loading={query.isLoading}
            density="compact"
            disableRowSelectionOnClick
            rowGroupingModel={rowGroupingModel}
            initialState={initialState}
            groupingColDef={{ headerName: 'Reaction', width: 180 }}
            defaultGroupingExpansionDepth={-1}
            sx={{ height: '100%' }}
          />
        </NoSsr>
      </Box>
    </Box>
  );
}
