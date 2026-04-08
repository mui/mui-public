'use client';

import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Alert from '@mui/material/Alert';
import WarningIcon from '@mui/icons-material/Warning';
import styled from '@emotion/styled';
import { fetchSnapshot } from '@/lib/bundleSize/fetchSnapshot';
import { calculateSizeDiff, type Size } from '@/lib/bundleSize/calculateSizeDiff';
import Heading from '../components/Heading';
import ReportHeader from '../components/ReportHeader';
import SizeChangeDisplay, {
  byteSizeFormatter,
  exactBytesFormatter,
} from '../components/SizeChangeDisplay';
import { useGitHubPR } from '../hooks/useGitHubPR';

/**
 * Generic hook to fetch size snapshots for the head branch
 */
function useSizeSnapshot(repo: string, sha: string) {
  return useQuery({
    queryKey: ['size-snapshot', repo, sha],
    queryFn: async () => fetchSnapshot(repo, sha),
    retry: 1,
  });
}

const BundleCell = styled(TableCell)`
  max-width: 40ch;
`;

/**
 * Props interface for the CompareTable component
 */
interface CompareTableProps {
  entries: Size[];
}

const CompareTable = React.memo(function CompareTable({ entries }: CompareTableProps) {
  return (
    <TableContainer>
      <Table>
        <TableHead>
          <TableRow>
            <BundleCell>Bundle</BundleCell>
            <TableCell align="right">Size change</TableCell>
            <TableCell align="right">Size</TableCell>
            <TableCell align="right">Gzip change</TableCell>
            <TableCell align="right">Gzip</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {entries.map(({ id, parsed, gzip }) => (
            <TableRow key={id}>
              <BundleCell>{id}</BundleCell>
              <TableCell align="right">
                {parsed.absoluteDiff === 0 ? (
                  '--'
                ) : (
                  <SizeChangeDisplay
                    absoluteChange={parsed.absoluteDiff}
                    relativeChange={parsed.relativeDiff}
                  />
                )}
              </TableCell>
              <TableCell align="right" title={exactBytesFormatter.format(parsed.current)}>
                {byteSizeFormatter.format(parsed.current)}
              </TableCell>
              <TableCell align="right">
                {gzip.absoluteDiff === 0 ? (
                  '--'
                ) : (
                  <SizeChangeDisplay
                    absoluteChange={gzip.absoluteDiff}
                    relativeChange={gzip.relativeDiff}
                  />
                )}
              </TableCell>
              <TableCell align="right" title={exactBytesFormatter.format(gzip.current)}>
                {byteSizeFormatter.format(gzip.current)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
});

/**
 * Props interface for the ComparisonTable component
 */
interface ComparisonTableProps {
  entries: Size[];
  isLoading: boolean;
  error?: Error | null;
}

// Pure presentational component that just renders the table
function ComparisonTable({ entries, isLoading, error }: ComparisonTableProps) {
  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2 }}>
        <CircularProgress size={16} />
        <Typography>Loading size comparison data...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 2, color: 'error.main' }}>
        <Typography variant="subtitle1" gutterBottom>
          Error loading comparison data
        </Typography>
        <Typography variant="body2">{error.message || 'Unknown error occurred'}</Typography>
      </Box>
    );
  }

  if (entries.length === 0) {
    return (
      <Box sx={{ p: 2, color: 'text.secondary' }}>
        <Typography>No comparison data available.</Typography>
      </Box>
    );
  }

  return <CompareTable entries={entries} />;
}

// Hook that handles data fetching and processing
function useSizeComparisonData(repo: string, baseCommit: string, headCommit: string) {
  const {
    data: baseSnapshot,
    isLoading: isBaseLoading,
    error: baseError,
  } = useSizeSnapshot(repo, baseCommit);

  const {
    data: targetSnapshot,
    isLoading: isTargetLoading,
    error: targetError,
  } = useSizeSnapshot(repo, headCommit);

  // Process data to get bundle comparisons and totals using the extracted function
  const { entries, totals, fileCounts } = React.useMemo(() => {
    if (!baseSnapshot || !targetSnapshot) {
      return {
        entries: [],
        totals: {
          totalParsed: 0,
          totalGzip: 0,
          totalParsedPercent: 0,
          totalGzipPercent: 0,
        },
        fileCounts: {
          added: 0,
          removed: 0,
          changed: 0,
          total: 0,
        },
      };
    }
    return calculateSizeDiff(baseSnapshot, targetSnapshot);
  }, [baseSnapshot, targetSnapshot]);

  const baseNotFound = !isBaseLoading && !baseError && baseSnapshot === null;
  const headNotFound = !isTargetLoading && !targetError && targetSnapshot === null;

  return {
    entries,
    totals,
    fileCounts,
    isLoading: isBaseLoading || isTargetLoading,
    error: targetError,
    baseError,
    baseNotFound,
    headNotFound,
  };
}

/**
 * Props interface for the Comparison component
 */
interface ComparisonProps {
  repo: string;
  baseRef: string;
  baseCommit: string;
  headCommit: string;
  prNumber?: number;
}

// Main comparison component that renders both the header and the table
function Comparison({ repo, baseRef, baseCommit, headCommit, prNumber }: ComparisonProps) {
  const { entries, totals, fileCounts, isLoading, error, baseError, baseNotFound, headNotFound } =
    useSizeComparisonData(repo, baseCommit, headCommit);

  return (
    <React.Fragment>
      <ReportHeader
        repo={repo}
        sha={headCommit}
        baseSha={baseNotFound ? null : baseCommit}
        prNumber={prNumber}
        baseRef={baseRef}
      />
      <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
        {baseNotFound && (
          <Alert severity="info" sx={{ mb: 2 }}>
            No size snapshot found for base commit{' '}
            <Link href={`https://github.com/${repo}/commit/${baseCommit}`} target="_blank">
              {baseCommit.substring(0, 7)}
            </Link>
            . Comparison may be incomplete.
          </Alert>
        )}
        {!baseNotFound && baseError && (
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <WarningIcon sx={{ fontSize: 16, color: 'warning.main', mr: 1 }} />
            <Typography variant="body2" color="warning.main">
              Error loading snapshot for base commit{' '}
              <Link href={`https://github.com/${repo}/commit/${baseCommit}`} target="_blank">
                {baseCommit.substring(0, 7)}
              </Link>
              . Comparison may be incomplete.
            </Typography>
          </Box>
        )}
        {headNotFound && (
          <Alert severity="info" sx={{ mb: 2 }}>
            No size snapshot found for head commit. The CI job may not have completed yet.
          </Alert>
        )}
        {!isLoading && !error && (
          <React.Fragment>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, mb: 1 }}>
              <Typography variant="body2">
                <strong>Total Size Change:</strong>{' '}
                {totals.totalParsed === 0 ? (
                  'No change'
                ) : (
                  <SizeChangeDisplay
                    absoluteChange={totals.totalParsed}
                    relativeChange={totals.totalParsedPercent}
                  />
                )}
              </Typography>
              <Typography variant="body2">
                <strong>Total Gzip Change:</strong>{' '}
                {totals.totalGzip === 0 ? (
                  'No change'
                ) : (
                  <SizeChangeDisplay
                    absoluteChange={totals.totalGzip}
                    relativeChange={totals.totalGzipPercent}
                  />
                )}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, mb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                <strong>Files:</strong> {fileCounts.total} total ({fileCounts.added} added,{' '}
                {fileCounts.removed} removed, {fileCounts.changed} changed)
              </Typography>
            </Box>
          </React.Fragment>
        )}
        <ComparisonTable entries={entries} isLoading={isLoading} error={error} />
      </Paper>
    </React.Fragment>
  );
}

export default function SizeComparison() {
  const searchParams = useSearchParams();
  const params = useParams<{ owner: string; repo: string }>();
  if (!params.owner || !params.repo) {
    throw new Error('Missing required path parameters');
  }

  const repo = `${params.owner}/${params.repo}`;
  const prNumberParam = searchParams.get('prNumber');
  const prNumber = prNumberParam ? Number(prNumberParam) : undefined;

  const { prInfo, isLoading, error } = useGitHubPR(repo, prNumber);

  if (isLoading) {
    return (
      <React.Fragment>
        <Heading level={1}>Bundle Size Comparison</Heading>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2 }}>
          <CircularProgress size={20} />
          <Typography>Loading PR information...</Typography>
        </Box>
      </React.Fragment>
    );
  }

  const shaParam = searchParams.get('sha') ?? searchParams.get('headCommit');
  const baseParam = searchParams.get('base') ?? searchParams.get('baseCommit');

  // We can show a comparison if we have sha and base
  const hasRequiredParams = shaParam && baseParam;

  if (!hasRequiredParams && (error || !prInfo)) {
    return (
      <React.Fragment>
        <Heading level={1}>Bundle Size Comparison</Heading>
        <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
          <Box sx={{ p: 2, color: 'error.main' }}>
            <Typography variant="h6" component="h2" gutterBottom>
              Error Loading Comparison Data
            </Typography>
            <Typography variant="body2">
              {error?.message || 'Could not load PR information'}
            </Typography>
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2">
                {prNumber
                  ? `Looking for PR #${prNumber} in repository ${repo}`
                  : 'Please provide sha and base parameters.'}
              </Typography>
            </Box>
          </Box>
        </Paper>
      </React.Fragment>
    );
  }

  // Use direct parameters if available, otherwise fall back to PR info
  const baseRef = searchParams.get('baseRef') ?? prInfo?.base.ref ?? 'main';
  const baseCommit = baseParam ?? prInfo?.base.sha ?? '';
  const headCommit = shaParam ?? prInfo?.head.sha ?? '';

  return (
    <React.Fragment>
      <Heading level={1}>Bundle Size Comparison</Heading>
      <Box sx={{ width: '100%' }}>
        <Comparison
          repo={repo}
          baseRef={baseRef}
          baseCommit={baseCommit}
          headCommit={headCommit}
          prNumber={prNumber}
        />
      </Box>
    </React.Fragment>
  );
}
