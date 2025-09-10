import * as React from 'react';
import { useParams, useSearchParams } from 'react-router';
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
import WarningIcon from '@mui/icons-material/Warning';
import styled from '@emotion/styled';
import { Size, calculateSizeDiff, fetchSnapshot } from '@mui/internal-bundle-size-checker/browser';
import Heading from '../components/Heading';
import GitHubPRReference from '../components/GitHubPRReference';
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
    data: baseSnapshot = {},
    isLoading: isBaseLoading,
    error: baseError,
  } = useSizeSnapshot(repo, baseCommit);

  const {
    data: targetSnapshot = null,
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

  return {
    entries,
    totals,
    fileCounts,
    isLoading: isBaseLoading || isTargetLoading,
    error: targetError,
    baseError,
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
  circleCIBuildNumber: number | null;
  prNumber?: number;
}

// Main comparison component that renders both the header and the table
function Comparison({
  repo,
  baseRef,
  baseCommit,
  headCommit,
  circleCIBuildNumber,
  prNumber,
}: ComparisonProps) {
  const { entries, totals, fileCounts, isLoading, error, baseError } = useSizeComparisonData(
    repo,
    baseCommit,
    headCommit,
  );

  return (
    <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
      <Box sx={{ mb: 3 }}>
        {prNumber && (
          <Typography variant="h6" component="h2" gutterBottom>
            <GitHubPRReference repo={`${repo}`} prNumber={prNumber} />
          </Typography>
        )}
        {!prNumber && (
          <Typography variant="h6" component="h2" gutterBottom>
            Bundle Size Comparison
          </Typography>
        )}
        <Typography variant="body2" color="text.secondary">
          {circleCIBuildNumber && (
            <React.Fragment>
              Circle CI build{' '}
              <Link
                href={`https://app.circleci.com/pipelines/github/${repo}/jobs/${circleCIBuildNumber}`}
                target="_blank"
              >
                {circleCIBuildNumber}
              </Link>
              .{' '}
            </React.Fragment>
          )}
          Comparing bundle size changes against {baseRef} (
          <Link href={`https://github.com/${repo}/commit/${baseCommit}`} target="_blank">
            {baseCommit.substring(0, 7)}
          </Link>
          ).
        </Typography>
        {baseError && (
          <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
            <WarningIcon sx={{ fontSize: 16, color: 'warning.main', mr: 1 }} />
            <Typography variant="body2" color="warning.main">
              No snapshot found for base commit{' '}
              <Link href={`https://github.com/${repo}/commit/${baseCommit}`} target="_blank">
                {baseCommit.substring(0, 7)}
              </Link>
              . Comparison may be incomplete.
            </Typography>
          </Box>
        )}
        {!isLoading && !error && (
          <React.Fragment>
            <Box sx={{ mt: 2, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
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
            <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              <Typography variant="body2" color="text.secondary">
                <strong>Files:</strong> {fileCounts.total} total ({fileCounts.added} added,{' '}
                {fileCounts.removed} removed, {fileCounts.changed} changed)
              </Typography>
            </Box>
          </React.Fragment>
        )}
      </Box>
      <ComparisonTable entries={entries} isLoading={isLoading} error={error} />
    </Paper>
  );
}

export default function SizeComparison() {
  const [searchParams] = useSearchParams();
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

  const circleCIBuildNumber = searchParams.get('circleCIBuildNumber');
  const baseCommitParam = searchParams.get('baseCommit');
  const headCommitParam = searchParams.get('headCommit');

  // We can show a comparison if we have baseCommit and headCommit
  const hasRequiredParams = baseCommitParam && headCommitParam;

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
                  : 'Please provide baseCommit and headCommit.'}
              </Typography>
            </Box>
          </Box>
        </Paper>
      </React.Fragment>
    );
  }

  // Use direct parameters if available, otherwise fall back to PR info
  const baseRef = searchParams.get('baseRef') ?? prInfo?.base.ref ?? 'main';
  const baseCommit = baseCommitParam ?? prInfo?.base.sha ?? '';
  const headCommit = headCommitParam ?? prInfo?.head.sha ?? '';

  return (
    <React.Fragment>
      <Heading level={1}>Bundle Size Comparison</Heading>
      <Box sx={{ width: '100%' }}>
        <Comparison
          repo={repo}
          baseRef={baseRef}
          baseCommit={baseCommit}
          headCommit={headCommit}
          circleCIBuildNumber={circleCIBuildNumber ? +circleCIBuildNumber : null}
          prNumber={prNumber}
        />
      </Box>
    </React.Fragment>
  );
}
