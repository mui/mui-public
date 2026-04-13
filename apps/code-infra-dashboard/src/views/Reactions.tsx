'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import NextLink from 'next/link';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  DataGridPremium,
  useGridApiRef,
  useKeepGroupedColumnsHidden,
  type GridColDef,
} from '@mui/x-data-grid-premium';
import Heading from '../components/Heading';
import ErrorDisplay from '../components/ErrorDisplay';
import { useSearchParamsState } from '../hooks/useSearchParamsState';
import { octokit, parseIssueUrl, type IssueReactionTarget } from '../utils/github';

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

interface ReactionRow {
  id: number;
  content: string;
  user: string;
  userUrl: string;
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
    field: 'user',
    headerName: 'User',
    flex: 1,
    minWidth: 200,
    renderCell: (cellParams) =>
      cellParams.row.userUrl ? (
        <Link
          href={cellParams.row.userUrl}
          target="_blank"
          rel="noopener noreferrer"
          underline="hover"
        >
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

export default function Reactions() {
  const [searchParams, setSearchParams] = useSearchParamsState(
    { url: { defaultValue: '' }, all: { defaultValue: '' } },
    { replace: true },
  );

  const unbounded = searchParams.all === '1';
  const loadAllHref = `/reactions?${new URLSearchParams({ url: searchParams.url, all: '1' })}`;

  const [draft, setDraft] = React.useState(searchParams.url);
  React.useEffect(() => {
    setDraft(searchParams.url);
  }, [searchParams.url]);

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
      <Heading level={1}>GitHub Reactions</Heading>
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
        <Button type="submit" variant="contained" disabled={!draft.trim()}>
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
      ) : (
        <DataGridPremium
          apiRef={apiRef}
          rows={query.data?.rows ?? []}
          columns={COLUMNS}
          loading={query.isLoading}
          density="compact"
          disableRowSelectionOnClick
          rowGroupingModel={rowGroupingModel}
          initialState={initialState}
          groupingColDef={{ headerName: 'Reaction', width: 240 }}
          defaultGroupingExpansionDepth={-1}
          sx={{ flex: 1, minHeight: 0, maxHeight: '100vh' }}
        />
      )}
    </Box>
  );
}
