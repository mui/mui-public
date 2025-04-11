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
import prettyBytes from 'pretty-bytes';
import styled from '@emotion/styled';
import ErrorBoundary from '../components/ErrorBoundary';
import Heading from '../components/Heading';

interface SizeSnapshot {
  [bundleId: string]: { parsed: number; gzip: number };
}

async function fetchSnapshot(url: string): Promise<SizeSnapshot> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch "${url}", HTTP ${response.status}`);
  }
  return response.json();
}

function useSizeSnapshot({ circleCIBuildNumber }: { circleCIBuildNumber: number }) {
  const downloadUrl = `/.netlify/functions/circle-ci-artifacts?buildNumber=${encodeURIComponent(circleCIBuildNumber)}`;

  return useQuery({
    queryKey: [downloadUrl],
    queryFn: () => fetchSnapshot(downloadUrl),
  });
}

function useS3SizeSnapshot(ref: string, commitId: string) {
  const downloadUrl = `https://s3.eu-central-1.amazonaws.com/mui-org-ci/artifacts/${encodeURIComponent(ref)}/${encodeURIComponent(commitId)}/size-snapshot.json`;

  return useQuery({
    queryKey: [downloadUrl],
    queryFn: () => fetchSnapshot(downloadUrl),
  });
}

/**
 * Generates a user-readable string from a percentage change
 * @param change
 * @param goodEmoji emoji on reduction
 * @param badEmoji emoji on increase
 */
function addPercent(
  change: number,
  goodEmoji: string = '',
  badEmoji: string = ':small_red_triangle:',
): string {
  const formatted = (change * 100).toFixed(2);
  if (/^-|^0(?:\.0+)$/.test(formatted)) {
    return `${formatted}% ${goodEmoji}`;
  }
  return `+${formatted}% ${badEmoji}`;
}

function formatDiff(absoluteChange: number, relativeChange: number): string {
  if (absoluteChange === 0) {
    return '--';
  }

  const trendIcon = absoluteChange < 0 ? '▼' : '▲';

  return `${trendIcon} ${prettyBytes(absoluteChange, {
    signed: true,
  })} (${addPercent(relativeChange, '', '')})`;
}

const BundleCell = styled(TableCell)`
  max-width: 40ch;
`;

const CompareTable = React.memo(function CompareTable({
  entries,
  getBundleLabel,
  renderBundleLabel = getBundleLabel,
}: {
  entries: [string, Size][];
  getBundleLabel: (bundleId: string) => string;
  renderBundleLabel?: (bundleId: string) => string;
}) {
  const rows = React.useMemo(() => {
    return (
      entries
        .map(([bundleId, size]): [string, Size & { id: string }] => [
          getBundleLabel(bundleId),
          { ...size, id: bundleId },
        ])
        // orderBy(|parsedDiff| DESC, |gzipDiff| DESC, name ASC)
        .sort(([labelA, statsA], [labelB, statsB]) => {
          const compareParsedDiff =
            Math.abs(statsB.parsed.absoluteDiff) - Math.abs(statsA.parsed.absoluteDiff);
          const compareGzipDiff =
            Math.abs(statsB.gzip.absoluteDiff) - Math.abs(statsA.gzip.absoluteDiff);
          const compareName = labelA.localeCompare(labelB);

          if (compareParsedDiff === 0 && compareGzipDiff === 0) {
            return compareName;
          }
          if (compareParsedDiff === 0) {
            return compareGzipDiff;
          }
          return compareParsedDiff;
        })
    );
  }, [entries, getBundleLabel]);

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
        {rows.map(([label, { parsed, gzip, id }]) => {
          return (
            <TableRow key={label}>
              <BundleCell>{renderBundleLabel(id)}</BundleCell>
              <TableCell align="right">
                {formatDiff(parsed.absoluteDiff, parsed.relativeDiff)}
              </TableCell>
              <TableCell align="right">{prettyBytes(parsed.current)}</TableCell>
              <TableCell align="right">
                {formatDiff(gzip.absoluteDiff, gzip.relativeDiff)}
              </TableCell>
              <TableCell align="right">{prettyBytes(gzip.current)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
});

function getMainBundleLabel(bundleId: string): string {
  if (bundleId === 'packages/material-ui/build/umd/material-ui.production.min.js') {
    return '@mui/material[umd]';
  }
  if (bundleId === '@mui/material/Textarea') {
    return 'TextareaAutosize';
  }
  if (bundleId === 'docs.main') {
    return 'docs:/_app';
  }
  if (bundleId === 'docs.landing') {
    return 'docs:/';
  }
  // eslint-disable-next-line no-console
  console.log(bundleId);
  return (
    bundleId
      // package renames
      .replace(/^@material-ui\/core$/, '@mui/material')
      .replace(/^@material-ui\/core.legacy$/, '@mui/material.legacy')
      .replace(/^@material-ui\/icons$/, '@mui/material-icons')
      .replace(/^@material-ui\/unstyled$/, '@mui/core')
      // org rename
      .replace(/^@material-ui\/([\w-]+)$/, '@mui/$1')
      // path renames
      .replace(
        /^packages\/material-ui\/material-ui\.production\.min\.js$/,
        'packages/mui-material/material-ui.production.min.js',
      )
      .replace(/^@material-ui\/core\//, '')
      .replace(/\.esm$/, '')
  );
}

interface Size {
  parsed: {
    previous: number;
    current: number;
    absoluteDiff: number;
    relativeDiff: number;
  };
  gzip: {
    previous: number;
    current: number;
    absoluteDiff: number;
    relativeDiff: number;
  };
}

const nullSnapshot = { parsed: 0, gzip: 0 };
function Comparison({
  baseRef,
  baseCommit,
  circleCIBuildNumber,
}: {
  baseRef: string;
  baseCommit: string;
  circleCIBuildNumber: number;
}) {
  const { data: baseSnapshot, isLoading: isBaseLoading } = useS3SizeSnapshot(baseRef, baseCommit);
  const { data: targetSnapshot, isLoading: isTargetLoading } = useSizeSnapshot({
    circleCIBuildNumber,
  });
  
  // Always define the useMemo hook, even when data is loading
  // This ensures the hook order remains stable between renders
  const { main: mainResults } = React.useMemo(() => {
    if (!baseSnapshot || !targetSnapshot) {
      return { main: [] };
    }
    
    const bundleKeys = Object.keys({ ...baseSnapshot, ...targetSnapshot });

    const main: [string, Size][] = [];
    bundleKeys.forEach((bundle) => {
      // current vs previous based off: https://github.com/mui/material-ui/blob/f1246e829f9c0fc9458ce951451f43c2f166c7d1/scripts/sizeSnapshot/loadComparison.js#L32
      // if a bundle was added the change should be +inf
      // if a bundle was removed the change should be -100%
      const currentSize = targetSnapshot[bundle] || nullSnapshot;
      const previousSize = baseSnapshot[bundle] || nullSnapshot;

      const entry: [string, Size] = [
        bundle,
        {
          parsed: {
            previous: previousSize.parsed,
            current: currentSize.parsed,
            absoluteDiff: currentSize.parsed - previousSize.parsed,
            relativeDiff: currentSize.parsed / previousSize.parsed - 1,
          },
          gzip: {
            previous: previousSize.gzip,
            current: currentSize.gzip,
            absoluteDiff: currentSize.gzip - previousSize.gzip,
            relativeDiff: currentSize.gzip / previousSize.gzip - 1,
          },
        },
      ];

      main.push(entry);
    });

    return { main };
  }, [baseSnapshot, targetSnapshot]);
  
  const isLoading = isBaseLoading || isTargetLoading;
  
  // Show a loading state if either query is still loading
  if (isLoading || !baseSnapshot || !targetSnapshot) {
    return (
      <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" component="h2" gutterBottom>
          Modules
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2 }}>
          <CircularProgress size={24} />
          <Typography>Loading size comparison data...</Typography>
        </Box>
      </Paper>
    );
  }

  return (
    <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
      <Typography variant="h6" component="h2" gutterBottom>
        Modules
      </Typography>
      <CompareTable entries={mainResults} getBundleLabel={getMainBundleLabel} />
    </Paper>
  );
}

function useComparisonParams() {
  const { search } = useLocation();
  return React.useMemo(() => {
    const params = new URLSearchParams(search);

    return {
      baseCommit: params.get('baseCommit')!,
      baseRef: params.get('baseRef')!,
      prNumber: +params.get('prNumber')!,
      circleCIBuildNumber: +params.get('circleCIBuildNumber')!,
    };
  }, [search]);
}

function ComparisonErrorFallback({ prNumber }: { prNumber: number }) {
  return (
    <p>
      Could not load comparison for{' '}
      <Link href={`https://github.com/mui/material-ui/pull/${prNumber}`}>#{prNumber}</Link>
      {". This can happen if the build in the CI job didn't finish yet. "}
      Reload this page once the CI job has finished.
    </p>
  );
}

export default function SizeComparison() {
  const { baseRef, baseCommit, circleCIBuildNumber, prNumber } = useComparisonParams();

  return (
    <React.Fragment>
      <Heading level={1}>Size comparison</Heading>
      <div>
        <ErrorBoundary fallback={<ComparisonErrorFallback prNumber={prNumber} />}>
          <Comparison
            baseRef={baseRef}
            baseCommit={baseCommit}
            circleCIBuildNumber={circleCIBuildNumber}
          />
        </ErrorBoundary>
      </div>
    </React.Fragment>
  );
}
