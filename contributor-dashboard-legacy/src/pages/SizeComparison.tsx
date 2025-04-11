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
function useCircleCISnapshot({ circleCIBuildNumber }: { circleCIBuildNumber: number }) {
  return useSizeSnapshotFromUrl(
    `/.netlify/functions/circle-ci-artifacts?buildNumber=${encodeURIComponent(circleCIBuildNumber)}`,
  );
}

/**
 * Hook to fetch size snapshots from S3
 */
function useS3SizeSnapshot(ref: string, commitId: string) {
  return useSizeSnapshotFromUrl(
    `https://s3.eu-central-1.amazonaws.com/mui-org-ci/artifacts/${encodeURIComponent(ref)}/${encodeURIComponent(commitId)}/size-snapshot.json`,
  );
}

// Formatter specifically for display in the UI with proper percentage formatting
const displayPercentFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  signDisplay: 'exceptZero',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
});

// Helper function that uses SizeChangeDisplay component to render diffs
function renderDiff(absoluteChange: number, relativeChange: number) {
  if (absoluteChange === 0) {
    return '--';
  }

  // Determine if this is a special bundle (new or removed)
  let specialLabel: 'new' | 'removed' | undefined;

  if (relativeChange === Infinity) {
    specialLabel = 'new';
  } else if (relativeChange === -Infinity) {
    specialLabel = 'removed';
  }

  // Return using our new component for consistency
  return (
    <SizeChangeDisplay
      absoluteChange={absoluteChange}
      relativeChange={Number.isFinite(relativeChange) ? relativeChange : undefined}
      specialLabel={specialLabel}
    />
  );
}

/**
 * Reusable component for displaying size changes with colored arrows
 */
function SizeChangeDisplay({
  absoluteChange,
  relativeChange,
  specialLabel,
}: {
  absoluteChange: number;
  relativeChange?: number;
  specialLabel?: 'new' | 'removed';
}): React.ReactElement | null {
  if (absoluteChange === 0) {
    return <React.Fragment>No change</React.Fragment>;
  }

  const isDecrease = absoluteChange < 0;
  const formattedSize = prettyBytes(Math.abs(absoluteChange));

  // Determine arrow color based on change type
  let arrowColor;
  let arrowIcon;

  if (specialLabel === 'new') {
    arrowIcon = '▲';
    arrowColor = 'warning.main'; // Orange for new
  } else if (specialLabel === 'removed') {
    arrowIcon = '▼';
    arrowColor = 'info.main'; // Blue for removed
  } else {
    arrowIcon = isDecrease ? '▼' : '▲';
    arrowColor = isDecrease ? 'success.main' : 'error.main';
  }

  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center' }}>
      <Box component="span" sx={{ color: arrowColor, mr: 0.5, fontWeight: 'bold' }}>
        {arrowIcon}
      </Box>
      <Box component="span">
        {isDecrease ? '-' : '+'}
        {formattedSize}

        {/* Render the special label or percentage in a less pronounced style */}
        {specialLabel && (
          <Box component="span" sx={{ ml: 0.5, fontSize: '0.85em', color: 'text.secondary' }}>
            ({specialLabel})
          </Box>
        )}

        {!specialLabel && relativeChange !== undefined && (
          <Box component="span" sx={{ ml: 0.5, fontSize: '0.85em', color: 'text.secondary' }}>
            ({displayPercentFormatter.format(relativeChange)})
          </Box>
        )}
      </Box>
    </Box>
  );
}

const BundleCell = styled(TableCell)`
  max-width: 40ch;
`;

const CompareTable = React.memo(function CompareTable({ entries }: { entries: [string, Size][] }) {
  const rows = React.useMemo(() => {
    return (
      entries
        .map(([bundleId, size]): [string, Size & { id: string }] => [
          bundleId,
          { ...size, id: bundleId },
        ])
        // Custom sorting:
        // 1. Existing bundles that increased in size (larger increases first)
        // 2. New bundles (larger sizes first)
        // 3. Existing bundles that decreased in size (larger decreases first)
        // 4. Removed bundles (larger sizes first)
        // 5. Unchanged bundles (alphabetically)
        .sort(([labelA, statsA], [labelB, statsB]) => {
          // Helper function to determine bundle category (for sorting)
          const getCategory = (stats: Size): number => {
            if (stats.parsed.relativeDiff === Infinity) {
              return 2; // New bundle
            }
            if (stats.parsed.relativeDiff === -Infinity) {
              return 4; // Removed bundle
            }
            if (stats.parsed.relativeDiff > 0) {
              return 1; // Increased
            }
            if (stats.parsed.relativeDiff < 0) {
              return 3; // Decreased
            }
            return 5; // Unchanged
          };

          // Get categories for both bundles
          const categoryA = getCategory(statsA);
          const categoryB = getCategory(statsB);

          // Sort by category first
          if (categoryA !== categoryB) {
            return categoryA - categoryB;
          }

          // Within the same category, sort by absolute diff (largest first)
          const diffA = Math.abs(statsA.parsed.absoluteDiff);
          const diffB = Math.abs(statsB.parsed.absoluteDiff);

          if (diffA !== diffB) {
            return diffB - diffA;
          }

          // If diffs are the same, sort by name
          return labelA.localeCompare(labelB);
        })
    );
  }, [entries]);

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
              <BundleCell>{id}</BundleCell>
              <TableCell align="right">
                {renderDiff(parsed.absoluteDiff, parsed.relativeDiff)}
              </TableCell>
              <TableCell align="right">{prettyBytes(parsed.current)}</TableCell>
              <TableCell align="right">
                {renderDiff(gzip.absoluteDiff, gzip.relativeDiff)}
              </TableCell>
              <TableCell align="right">{prettyBytes(gzip.current)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
});

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
// Pure presentational component that just renders the table
function ComparisonTable({
  entries,
  isLoading,
  error,
}: {
  entries: [string, Size][];
  isLoading: boolean;
  error?: Error | null;
}) {
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
function useSizeComparisonData(baseRef: string, baseCommit: string, circleCIBuildNumber: number) {
  const {
    data: baseSnapshot,
    isLoading: isBaseLoading,
    error: baseError,
  } = useS3SizeSnapshot(baseRef, baseCommit);

  const {
    data: targetSnapshot,
    isLoading: isTargetLoading,
    error: targetError,
  } = useCircleCISnapshot({
    circleCIBuildNumber,
  });

  // Process data to get bundle comparisons and totals
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

    const bundleKeys = Object.keys({ ...baseSnapshot, ...targetSnapshot });
    const results: [string, Size][] = [];

    // Track totals
    let totalParsed = 0;
    let totalGzip = 0;
    let totalParsedPrevious = 0;
    let totalGzipPrevious = 0;

    // Track file counts
    let addedFiles = 0;
    let removedFiles = 0;
    let changedFiles = 0;

    bundleKeys.forEach((bundle) => {
      const isNewBundle = !baseSnapshot[bundle];
      const isRemovedBundle = !targetSnapshot[bundle];
      const currentSize = targetSnapshot[bundle] || nullSnapshot;
      const previousSize = baseSnapshot[bundle] || nullSnapshot;

      // Update file counts
      if (isNewBundle) {
        addedFiles++;
      } else if (isRemovedBundle) {
        removedFiles++;
      } else if (
        currentSize.parsed !== previousSize.parsed ||
        currentSize.gzip !== previousSize.gzip
      ) {
        changedFiles++;
      }

      const parsedDiff = currentSize.parsed - previousSize.parsed;
      const gzipDiff = currentSize.gzip - previousSize.gzip;

      // Calculate relative diffs with appropriate handling of new/removed bundles
      let parsedRelativeDiff: number;
      if (isNewBundle) {
        parsedRelativeDiff = Infinity;
      } else if (isRemovedBundle) {
        parsedRelativeDiff = -Infinity;
      } else if (previousSize.parsed) {
        parsedRelativeDiff = currentSize.parsed / previousSize.parsed - 1;
      } else {
        parsedRelativeDiff = 0;
      }

      let gzipRelativeDiff: number;
      if (isNewBundle) {
        gzipRelativeDiff = Infinity;
      } else if (isRemovedBundle) {
        gzipRelativeDiff = -Infinity;
      } else if (previousSize.gzip) {
        gzipRelativeDiff = currentSize.gzip / previousSize.gzip - 1;
      } else {
        gzipRelativeDiff = 0;
      }

      const entry: [string, Size] = [
        bundle,
        {
          parsed: {
            previous: previousSize.parsed,
            current: currentSize.parsed,
            absoluteDiff: parsedDiff,
            relativeDiff: parsedRelativeDiff,
          },
          gzip: {
            previous: previousSize.gzip,
            current: currentSize.gzip,
            absoluteDiff: gzipDiff,
            relativeDiff: gzipRelativeDiff,
          },
        },
      ];

      results.push(entry);

      // Update totals
      totalParsed += parsedDiff;
      totalGzip += gzipDiff;
      totalParsedPrevious += previousSize.parsed;
      totalGzipPrevious += previousSize.gzip;
    });

    // Calculate percentage changes
    const totalParsedPercent = totalParsedPrevious > 0 ? totalParsed / totalParsedPrevious : 0;
    const totalGzipPercent = totalGzipPrevious > 0 ? totalGzip / totalGzipPrevious : 0;

    return {
      entries: results,
      totals: {
        totalParsed,
        totalGzip,
        totalParsedPercent,
        totalGzipPercent,
      },
      fileCounts: {
        added: addedFiles,
        removed: removedFiles,
        changed: changedFiles,
        total: bundleKeys.length,
      },
    };
  }, [baseSnapshot, targetSnapshot]);

  return {
    entries,
    totals,
    fileCounts,
    isLoading: isBaseLoading || isTargetLoading,
    error: baseError || targetError,
  };
}

// Main comparison component that renders both the header and the table
function Comparison({
  baseRef,
  baseCommit,
  circleCIBuildNumber,
  prNumber,
}: {
  baseRef: string;
  baseCommit: string;
  circleCIBuildNumber: number;
  prNumber: number;
}) {
  const { entries, totals, fileCounts, isLoading, error } = useSizeComparisonData(
    baseRef,
    baseCommit,
    circleCIBuildNumber,
  );

  return (
    <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="body2" color="text.secondary">
          Comparing size changes between {baseRef} (
            <Link 
              href={`https://github.com/mui/material-ui/commit/${baseCommit}`} 
              target="_blank"
            >
              {baseCommit.substring(0, 7)}
            </Link>
          ) and PR{' '}
          <Link href={`https://github.com/mui/material-ui/pull/${prNumber}`} target="_blank">
            #{prNumber}
          </Link>, Circle CI build{' '}
          <Link
            href={`https://app.circleci.com/pipelines/github/mui/material-ui/jobs/${circleCIBuildNumber}`}
            target="_blank"
          >
            {circleCIBuildNumber}
          </Link>
        </Typography>

        {!isLoading && !error && (
          <React.Fragment>
            <Box sx={{ mt: 2, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              <Typography variant="body2">
                <strong>Total Size Change:</strong>{' '}
                <SizeChangeDisplay
                  absoluteChange={totals.totalParsed}
                  relativeChange={totals.totalParsedPercent}
                />
              </Typography>
              <Typography variant="body2">
                <strong>Total Gzip Change:</strong>{' '}
                <SizeChangeDisplay
                  absoluteChange={totals.totalGzip}
                  relativeChange={totals.totalGzipPercent}
                />
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
      Could not load comparison for PR{' '}
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
      <Heading level={1}>Bundle Size Comparison</Heading>
      <Box sx={{ width: '100%' }}>
        <ErrorBoundary fallback={<ComparisonErrorFallback prNumber={prNumber} />}>
          <Comparison
            baseRef={baseRef}
            baseCommit={baseCommit}
            circleCIBuildNumber={circleCIBuildNumber}
            prNumber={prNumber}
          />
        </ErrorBoundary>
      </Box>
    </React.Fragment>
  );
}
