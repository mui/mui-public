'use client';

import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Alert from '@mui/material/Alert';
import styled from '@emotion/styled';
import { fetchCiReport } from '@/utils/fetchCiReport';
import { calculateSizeDiff, type Size } from '@/lib/bundleSize/calculateSizeDiff';
import Heading from '../components/Heading';
import ReportHeader from '../components/ReportHeader';
import SizeChangeDisplay, {
  byteSizeFormatter,
  exactBytesFormatter,
} from '../components/SizeChangeDisplay';

function useSizeSnapshot(repo: string, sha: string | null) {
  return useQuery({
    queryKey: ['size-snapshot', repo, sha],
    queryFn: () => fetchCiReport(repo, sha!, 'size-snapshot.json'),
    retry: 1,
    enabled: Boolean(sha),
  });
}

const BundleCell = styled(TableCell)`
  max-width: 40ch;
`;

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

export default function SizeComparison() {
  const searchParams = useSearchParams();
  const params = useParams<{ owner: string; repo: string }>();
  if (!params.owner || !params.repo) {
    throw new Error('Missing required path parameters');
  }

  const repo = `${params.owner}/${params.repo}`;
  const sha = searchParams.get('sha') ?? searchParams.get('headCommit');
  const prNumberParam = searchParams.get('prNumber');
  const prNumber = prNumberParam ? Number(prNumberParam) : undefined;
  const baseRef = searchParams.get('baseRef');
  const baseSha = searchParams.get('base') ?? searchParams.get('baseCommit');

  const {
    data: headSnapshot,
    isLoading: isHeadLoading,
    error: headError,
  } = useSizeSnapshot(repo, sha);

  const {
    data: baseSnapshot,
    isLoading: isBaseLoading,
    error: baseError,
  } = useSizeSnapshot(repo, baseSha);

  const headNotFound = !isHeadLoading && !headError && headSnapshot === null && Boolean(sha);
  const baseNotFound = !isBaseLoading && !baseError && baseSnapshot === null && Boolean(baseSha);

  const comparison = React.useMemo(() => {
    if (!headSnapshot || isBaseLoading) {
      return null;
    }
    return calculateSizeDiff(baseSnapshot ?? {}, headSnapshot);
  }, [baseSnapshot, headSnapshot, isBaseLoading]);

  if (!sha) {
    return (
      <React.Fragment>
        <Heading level={1}>Bundle Size Comparison</Heading>
        <Paper elevation={2} sx={{ p: 3 }}>
          <Typography color="error">Missing required &quot;sha&quot; query parameter.</Typography>
        </Paper>
      </React.Fragment>
    );
  }

  const effectiveBaseSha = baseSha && !baseNotFound ? baseSha : null;

  return (
    <React.Fragment>
      <Heading level={1}>Bundle Size Comparison</Heading>

      <ReportHeader
        repo={repo}
        sha={sha}
        baseSha={effectiveBaseSha}
        prNumber={prNumber}
        baseRef={baseRef ?? undefined}
      />

      <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
        {headNotFound && (
          <Alert severity="info" sx={{ mb: 2 }}>
            No size snapshot found for head commit. The CI job may not have completed yet.
          </Alert>
        )}

        {(isHeadLoading || isBaseLoading) && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <CircularProgress size={16} />
            <Typography>Loading size comparison data...</Typography>
          </Box>
        )}

        {headError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Error loading head snapshot: {headError.message}
          </Alert>
        )}

        {baseError && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Error loading base snapshot. Comparison may be incomplete.
          </Alert>
        )}

        {comparison && (
          <React.Fragment>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, mb: 1 }}>
              <Typography variant="body2">
                <strong>Total Size Change:</strong>{' '}
                {comparison.totals.totalParsed === 0 ? (
                  'No change'
                ) : (
                  <SizeChangeDisplay
                    absoluteChange={comparison.totals.totalParsed}
                    relativeChange={comparison.totals.totalParsedPercent}
                  />
                )}
              </Typography>
              <Typography variant="body2">
                <strong>Total Gzip Change:</strong>{' '}
                {comparison.totals.totalGzip === 0 ? (
                  'No change'
                ) : (
                  <SizeChangeDisplay
                    absoluteChange={comparison.totals.totalGzip}
                    relativeChange={comparison.totals.totalGzipPercent}
                  />
                )}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, mb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                <strong>Files:</strong> {comparison.fileCounts.total} total (
                {comparison.fileCounts.added} added, {comparison.fileCounts.removed} removed,{' '}
                {comparison.fileCounts.changed} changed)
              </Typography>
            </Box>
            <CompareTable entries={comparison.entries} />
          </React.Fragment>
        )}
      </Paper>
    </React.Fragment>
  );
}
