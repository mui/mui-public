import * as React from 'react';
import { useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import styled from '@emotion/styled';
import { SizeSnapshot, Size, calculateSizeDiff } from '@mui/internal-bundle-size-checker';
import Heading from '../components/Heading';
import GitHubPRReference from '../components/GitHubPRReference';
import SizeChangeDisplay, {
  byteSizeFormatter,
  exactBytesFormatter,
} from '../components/SizeChangeDisplay';

async function fetchSnapshot(url: string): Promise<SizeSnapshot> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch "${url}", HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Generic hook to fetch size snapshots from any URL
 */
function useSizeSnapshotFromUrl(url: string) {
  return useQuery({
    queryKey: [url],
    queryFn: () => fetchSnapshot(url),
  });
}

/**
 * Hook to fetch size snapshots from CircleCI artifacts
 */
function useCircleCISnapshot({
  org,
  repository,
  circleCIBuildNumber,
}: {
  org: string;
  repository: string;
  circleCIBuildNumber: number;
}) {
  const url = new URL('/.netlify/functions/circle-ci-artifacts', window.location.origin);
  url.searchParams.append('org', org);
  url.searchParams.append('repository', repository);
  url.searchParams.append('buildNumber', String(circleCIBuildNumber));

  return useSizeSnapshotFromUrl(url.toString());
}

/**
 * Hook to fetch size snapshots from S3
 */
function useS3SizeSnapshot(org: string, repo: string, ref: string, commitId: string) {
  // TODO: store artifacts under a url that includes the repo name
  const path = `${encodeURIComponent(ref)}/${encodeURIComponent(commitId)}/size-snapshot.json`;
  const url = new URL(path, 'https://s3.eu-central-1.amazonaws.com/mui-org-ci/artifacts/');
  return useSizeSnapshotFromUrl(url.toString());
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
    <Table>
      <TableHead>
        <TableRow>
          <BundleCell>bundle</BundleCell>
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
function useSizeComparisonData(
  baseOrg: string,
  baseRepo: string,
  baseRef: string,
  baseCommit: string,
  circleCIBuildNumber: number,
) {
  const {
    data: baseSnapshot = null,
    isLoading: isBaseLoading,
    error: baseError,
  } = useS3SizeSnapshot(baseOrg, baseRepo, baseRef, baseCommit);

  const {
    data: targetSnapshot = null,
    isLoading: isTargetLoading,
    error: targetError,
  } = useCircleCISnapshot({
    org: baseOrg,
    repository: baseRepo,
    circleCIBuildNumber,
  });

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
    error: baseError || targetError,
  };
}

/**
 * Props interface for the Comparison component
 */
interface ComparisonProps {
  baseOrg: string;
  baseRepo: string;
  baseRef: string;
  baseCommit: string;
  circleCIBuildNumber: number;
  prNumber: number;
}

// Main comparison component that renders both the header and the table
function Comparison({
  baseOrg,
  baseRepo,
  baseRef,
  baseCommit,
  circleCIBuildNumber,
  prNumber,
}: ComparisonProps) {
  const { entries, totals, fileCounts, isLoading, error } = useSizeComparisonData(
    baseOrg,
    baseRepo,
    baseRef,
    baseCommit,
    circleCIBuildNumber,
  );

  return (
    <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h6" component="h2" gutterBottom>
          <GitHubPRReference repo={`${baseOrg}/${baseRepo}`} prNumber={prNumber} />
        </Typography>

        <Typography variant="body2" color="text.secondary">
          Circle CI build{' '}
          <Link
            href={`https://app.circleci.com/pipelines/github/${baseOrg}/${baseRepo}/jobs/${circleCIBuildNumber}`}
            target="_blank"
          >
            {circleCIBuildNumber}
          </Link>
          . Comparing bundle size changes against {baseRef} (
          <Link
            href={`https://github.com/${baseOrg}/${baseRepo}/commit/${baseCommit}`}
            target="_blank"
          >
            {baseCommit.substring(0, 7)}
          </Link>
          ).
        </Typography>

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

function useComparisonParams() {
  const { search } = useLocation();
  return React.useMemo(() => {
    const params = new URLSearchParams(search);

    return {
      baseOrg: params.get('baseOrg') || 'mui',
      baseRepo: params.get('baseRepo') || 'material-ui',
      baseCommit: params.get('baseCommit')!,
      baseRef: params.get('baseRef')!,
      prNumber: +params.get('prNumber')!,
      circleCIBuildNumber: +params.get('circleCIBuildNumber')!,
    };
  }, [search]);
}

export default function SizeComparison() {
  const { baseOrg, baseRepo, baseRef, baseCommit, circleCIBuildNumber, prNumber } =
    useComparisonParams();

  return (
    <React.Fragment>
      <Heading level={1}>Bundle Size Comparison</Heading>
      <Box sx={{ width: '100%' }}>
        <Comparison
          baseOrg={baseOrg}
          baseRepo={baseRepo}
          baseRef={baseRef}
          baseCommit={baseCommit}
          circleCIBuildNumber={circleCIBuildNumber}
          prNumber={prNumber}
        />
      </Box>
    </React.Fragment>
  );
}
