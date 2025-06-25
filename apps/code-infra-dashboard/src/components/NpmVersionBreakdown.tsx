import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Link from '@mui/material/Link';
import { Link as RouterLink, useSearchParams } from 'react-router';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableRow from '@mui/material/TableRow';
import Alert from '@mui/material/Alert';
import Skeleton from '@mui/material/Skeleton';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { PieChart } from '@mui/x-charts/PieChart';
import { LineChart } from '@mui/x-charts/LineChart';
import * as semver from 'semver';
import { HighlightItemData, PieItemIdentifier, PieValueType } from '@mui/x-charts';
import { useEventCallback } from '@mui/material';
import {
  HistoricalData,
  fetchNpmPackageVersions,
  fetchNpmPackageHistory,
  PackageVersion,
  fetchNpmPackageDetails,
  Package,
} from '../lib/npm';

export interface UseNpmPackage {
  packageDetails: Package | null;
  isLoading: boolean;
  error: Error | null;
}

function dateValueFormatter(date: Date) {
  return date.toLocaleDateString(undefined, {
    month: '2-digit',
    day: '2-digit',
  });
}

function downloadsValueFormatter(value: number) {
  return value.toLocaleString(undefined, {
    notation: 'compact',
    compactDisplay: 'short',
  });
}

export function useNpmPackage(packageName: string | null): UseNpmPackage {
  const {
    data = null,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['npmPackageDetails', packageName],
    queryFn: () => fetchNpmPackageDetails(packageName!),
    enabled: !!packageName,
    staleTime: 10 * 60 * 1000, // 10 minutes
  });

  return {
    packageDetails: data,
    isLoading,
    error: error as Error | null,
  };
}

const COLORS = [
  '#ea5545',
  '#f46a9b',
  '#ef9b20',
  '#edbf33',
  '#ede15b',
  '#bdcf32',
  '#87bc45',
  '#27aeef',
  '#b33dc6',
];

interface UsePackageVersions {
  isLoading: boolean;
  error: Error | null;
  state: BreakdownState | null;
}

function usePackageVersions(
  packageName: string | null,
  selectedVersion: string | null,
): UsePackageVersions {
  // Fetch version data
  const {
    data: versions = {},
    isLoading,
    error,
  } = useQuery({
    queryKey: ['npmPackageVersions', packageName],
    queryFn: () => fetchNpmPackageVersions(packageName!),
    enabled: !!packageName,
    staleTime: 10 * 60 * 1000, // 10 minutes
  });

  // Get current breakdown state (only if we have version data)
  const state =
    Object.keys(versions).length > 0 ? getBreakdownState(versions, selectedVersion) : null;

  return {
    isLoading,
    error: error as Error | null,
    state,
  };
}

interface PackageDetailsSectionProps {
  packageName: string | null;
}

function PackageDetailsSection({ packageName }: PackageDetailsSectionProps) {
  const { isLoading, error, packageDetails } = useNpmPackage(packageName);

  if (error) {
    return (
      <Alert severity="error" sx={{ mb: 3 }}>
        Failed to load package details: {error.message}
      </Alert>
    );
  }

  if (!isLoading && !packageDetails) {
    return (
      <Alert severity="info" sx={{ mb: 3 }}>
        No package data available
      </Alert>
    );
  }

  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="h2" sx={{ mb: 1 }}>
        {packageDetails?.name ?? packageName ?? <Skeleton width={200} />}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {packageDetails ? (
          `Author: ${packageDetails.author} • Latest: v${packageDetails.version}`
        ) : (
          <Skeleton width={300} />
        )}
      </Typography>
      <Typography variant="body1" color="text.secondary" paragraph>
        {packageDetails ? packageDetails.description : <Skeleton width="80%" />}
      </Typography>
    </Box>
  );
}

interface BreakdownTableRowProps {
  item: BreakdownItem | null;
  color?: string;
  onItemClick?: (nextVersion: string | null) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  isHovered?: boolean;
}

function BreakdownTableRow({
  item,
  color = '#ccc',
  onItemClick,
  onMouseEnter,
  onMouseLeave,
  isHovered = false,
}: BreakdownTableRowProps) {
  const isClickable = item?.nextVersion !== null && !!onItemClick;

  return (
    <TableRow
      hover={isClickable}
      onClick={isClickable ? () => onItemClick!(item!.nextVersion) : undefined}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      sx={{
        '&:last-child td, &:last-child th': { border: 0 },
        cursor: isClickable ? 'pointer' : 'default',
        backgroundColor: isHovered ? 'action.hover' : 'transparent',
        '&:hover': {
          backgroundColor: isClickable ? 'action.hover' : 'transparent',
        },
      }}
    >
      <TableCell sx={{ width: 40, textAlign: 'center' }}>
        {item ? (
          <Box
            sx={{
              width: 16,
              height: 16,
              backgroundColor: color,
              borderRadius: '50%',
            }}
          />
        ) : (
          <Skeleton variant="circular" width={16} height={16} />
        )}
      </TableCell>
      <TableCell sx={{ width: 100 }}>
        <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
          {item ? item.label : <Skeleton />}
        </Typography>
      </TableCell>
      <TableCell align="right" sx={{ width: 250 }}>
        <Typography variant="body2">
          {item ? (
            `${item.downloads.toLocaleString()} downloads (${item.percentage.toFixed(1)}%)`
          ) : (
            <Skeleton />
          )}
        </Typography>
      </TableCell>
      <TableCell align="right">
        <Typography variant="body2" color="text.secondary">
          {item ? (
            <React.Fragment>
              {item.publishedAt ? new Date(item.publishedAt).toLocaleDateString() : 'Unknown'}
            </React.Fragment>
          ) : (
            <Skeleton sx={{ display: 'inline-block' }} width={80} />
          )}
        </Typography>
      </TableCell>
      <TableCell align="right" sx={{ width: 40 }}>
        <ChevronRightIcon
          color="action"
          fontSize="small"
          sx={{
            visibility: item && isClickable ? 'visible' : 'hidden',
          }}
        />
      </TableCell>
    </TableRow>
  );
}

interface BreakdownVisualizationProps {
  state?: BreakdownState | null;
  onItemClick: (nextVersion: string | null) => void;
  hoveredIndex: number | null;
  onHoverChange: (index: number | null) => void;
}

function BreakdownVisualization({
  state,
  onItemClick,
  hoveredIndex,
  onHoverChange,
}: BreakdownVisualizationProps) {
  // Generate chart data with memoization
  const chartData: PieValueType[] = React.useMemo(
    () =>
      state
        ? state.breakdownItems.map((item, index) => ({
            id: item.id,
            label: item.label,
            value: item.downloads,
            color: COLORS[index % COLORS.length],
          }))
        : [],
    [state],
  );

  // Memoize value formatter to prevent recreation on every render
  const valueFormatter = React.useCallback(
    (item: { value: number }) => {
      let label = `${item.value.toLocaleString()} downloads`;
      if (state) {
        const percentage = (100 * item.value) / state.globalTotalDownloads;
        label += ` (${percentage.toFixed(1)}%)`;
      }
      return label;
    },
    [state],
  );

  // Handle chart clicks
  const handleChartClick = useEventCallback((event: any, item: PieItemIdentifier) => {
    if (!state) {
      return;
    }
    if (onItemClick && state.breakdownItems[item.dataIndex]) {
      const breakdownItem = state.breakdownItems[item.dataIndex];
      if (breakdownItem.nextVersion !== null) {
        onItemClick(breakdownItem.nextVersion);
      }
    }
  });

  // Handle chart hover
  const handleChartItemHover = useEventCallback((item: HighlightItemData | null) => {
    onHoverChange(item?.dataIndex ?? null);
  });

  // Handle table row hover
  const handleTableRowHover = useEventCallback((index: number | null) => {
    onHoverChange(index);
  });

  return (
    <Box sx={{ mb: 4 }}>
      {/* Pie Chart + List */}
      <Box
        sx={{
          display: 'flex',
          gap: 3,
          flexDirection: { xs: 'column', md: 'row' },
        }}
      >
        <Box
          sx={{
            width: { xs: '100%', md: 400 },
            height: 400,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <PieChart
            series={[
              {
                id: 'versions',
                data: chartData,
                arcLabel: 'label',
                arcLabelMinAngle: 10,
                valueFormatter,
                highlightScope: { fade: 'global', highlight: 'item' },
              },
            ]}
            width={400}
            height={400}
            onItemClick={state?.canGoForward ? handleChartClick : undefined}
            highlightedItem={
              hoveredIndex !== null ? { seriesId: 'versions', dataIndex: hoveredIndex } : null
            }
            onHighlightChange={handleChartItemHover}
            margin={{ top: 40, right: 40, bottom: 40, left: 40 }}
            loading={!state}
            hideLegend
          />
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <TableContainer sx={{ maxHeight: 400 }}>
            <Table stickyHeader size="small">
              <TableBody>
                {state
                  ? state.breakdownItems.map((item, index) => (
                      <BreakdownTableRow
                        key={item.id}
                        item={item}
                        color={COLORS[index % COLORS.length]}
                        onItemClick={onItemClick}
                        onMouseEnter={() => handleTableRowHover(index)}
                        onMouseLeave={() => handleTableRowHover(null)}
                        isHovered={hoveredIndex === index}
                      />
                    ))
                  : Array.from({ length: 3 }, (_, index) => (
                      <BreakdownTableRow key={`skeleton-${index}`} item={null} />
                    ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      </Box>
    </Box>
  );
}

interface HistoricalTrendsSectionProps {
  packageName: string | null;
  selectedVersion: string | null;
  hoveredIndex: number | null;
  onHoverChange: (index: number | null) => void;
}

function HistoricalTrendsSection({
  packageName,
  selectedVersion,
  hoveredIndex,
  onHoverChange,
}: HistoricalTrendsSectionProps) {
  // Fetch historical data
  const {
    data: historicalData,
    isLoading,
    error: historyError,
  } = useQuery({
    queryKey: ['npmPackageHistory', packageName],
    queryFn: () => fetchNpmPackageHistory(packageName!),
    enabled: !!packageName,
    staleTime: 60 * 60 * 1000, // 1 hour
  });

  const historicalChartData = React.useMemo(() => {
    if (!historicalData) {
      return { timestamps: [], series: [] };
    }
    return getHistoricalBreakdownData(historicalData, selectedVersion);
  }, [historicalData, selectedVersion]);

  // Handle line chart hover
  const handleLineChartHover = useEventCallback((item: HighlightItemData | null) => {
    const index = historicalChartData.series.findIndex((series) => series.id === item?.seriesId);
    onHoverChange(index ?? null);
  });

  // Early return if no package name
  if (!packageName) {
    return null;
  }

  if (historyError) {
    return <Alert severity="error">Failed to load historical data: {historyError.message}</Alert>;
  }

  return (
    <Box sx={{ width: '100%', height: 400 }}>
      <LineChart
        series={historicalChartData.series.map((series, index) => ({
          ...series,
          color: COLORS[index % COLORS.length],
          highlightScope: { fade: 'global', highlight: 'series' },
          showMark: series.data.length <= 1,
        }))}
        xAxis={[
          {
            data: historicalChartData.timestamps,
            scaleType: 'time',
            valueFormatter: dateValueFormatter,
            label: 'Date',
          },
        ]}
        loading={isLoading}
        yAxis={[{ label: 'Downloads', valueFormatter: downloadsValueFormatter }]}
        height={300}
        highlightedItem={
          hoveredIndex !== null ? { seriesId: historicalChartData.series[hoveredIndex]?.id } : null
        }
        onHighlightChange={handleLineChartHover}
      />
    </Box>
  );
}

interface PackageVersionsSectionProps {
  packageName: string | null;
  selectedVersion: string | null;
  onVersionChange: (version: string | null) => void;
}

function PackageVersionsSection({
  packageName,
  selectedVersion,
  onVersionChange,
}: PackageVersionsSectionProps) {
  const [searchParams] = useSearchParams();
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null);

  const { isLoading, error, state } = usePackageVersions(packageName, selectedVersion);

  // Early return if no package name
  if (!packageName) {
    return null;
  }

  // Helper function to create URLs preserving other search params
  const createVersionUrl = (version: string | null): string => {
    const newSearchParams = new URLSearchParams(searchParams);
    if (version === null) {
      newSearchParams.delete('version');
    } else {
      newSearchParams.set('version', version);
    }
    return `?${newSearchParams.toString()}`;
  };

  const selectedParts = selectedVersion ? selectedVersion.split('.') : [];
  const currentLevel = selectedParts.length;

  // Generate breadcrumbs
  const breadcrumbs: BreadcrumbItem[] = [
    {
      label: 'All Versions',
      version: null,
      isActive: currentLevel === 0,
    },
  ];

  // Add breadcrumbs for each level
  for (let i = 0; i < currentLevel; i += 1) {
    const versionParts = selectedParts.slice(0, i + 1);
    const version = versionParts.join('.');
    const isActive = i === currentLevel - 1;

    breadcrumbs.push({
      label: `v${padVersion(version, 'x', versionParts.length + 1)}`,
      version,
      isActive,
    });
  }

  return (
    <div>
      <Typography variant="h3" sx={{ mb: 2 }}>
        Version Breakdown
      </Typography>

      <Breadcrumbs aria-label="version navigation" sx={{ mb: 2 }}>
        {breadcrumbs.map((breadcrumb, index) =>
          breadcrumb.isActive ? (
            <Typography key={index} color="text.primary">
              {breadcrumb.label}
            </Typography>
          ) : (
            <Link
              key={index}
              component={RouterLink}
              to={createVersionUrl(breadcrumb.version)}
              sx={{
                textDecoration: 'none',
                color: 'primary.main',
                '&:hover': {
                  textDecoration: 'underline',
                },
              }}
            >
              {breadcrumb.label}
            </Link>
          ),
        )}
      </Breadcrumbs>

      {/* Error State */}
      {error && (
        <Alert severity="error" sx={{ mb: 4 }}>
          Failed to load version data: {error.message}
        </Alert>
      )}

      {/* Visualization */}
      {!error && (
        <BreakdownVisualization
          state={isLoading ? null : state}
          onItemClick={onVersionChange}
          hoveredIndex={hoveredIndex}
          onHoverChange={setHoveredIndex}
        />
      )}

      {/* Historical Trends */}
      <Box sx={{ mt: 4 }}>
        <Typography variant="h3" sx={{ mb: 2 }}>
          Historical Download Trends
        </Typography>
        <HistoricalTrendsSection
          packageName={packageName}
          selectedVersion={selectedVersion}
          hoveredIndex={hoveredIndex}
          onHoverChange={setHoveredIndex}
        />
      </Box>
    </div>
  );
}

interface NpmVersionBreakdownProps {
  packageName: string | null;
  selectedVersion: string | null;
  onVersionChange: (version: string | null) => void;
}

interface BreakdownItem {
  id: string;
  label: string;
  downloads: number;
  count?: number;
  publishedAt?: null | string;
  nextVersion: null | string;
  sortKey: number;
  percentage: number;
}

interface BreadcrumbItem {
  label: string;
  version: string | null;
  isActive: boolean;
}

interface BreakdownState {
  canGoForward: boolean;
  breakdownItems: BreakdownItem[];
  globalTotalDownloads: number;
}

function padVersion(version: string, padWith: string = '0', length = 3): string {
  const parts = version.split('.');
  while (parts.length < Math.min(length, 3)) {
    parts.push(padWith);
  }
  return parts.join('.');
}

function getNextLevelKey(version: string, selectedVersion: null | string): string {
  const cleanVersion = semver.valid(semver.coerce(version));
  if (!cleanVersion) {
    return version;
  }

  const versionParts = cleanVersion.split('.');
  const selectedParts = selectedVersion ? selectedVersion.split('.') : [];

  // Take parts up to selectedVersion length + 1
  const nextLevelParts = versionParts.slice(0, selectedParts.length + 1);

  return nextLevelParts.join('.');
}

function getBreakdownState(
  packageVersions: Record<string, PackageVersion>,
  selectedVersion: null | string = null,
): BreakdownState {
  const versionKeys = Object.keys(packageVersions || {});

  // Filter versions that match the current selection using semver
  const matchingVersions = selectedVersion
    ? versionKeys.filter((version) => {
        const cleanVersion = semver.valid(semver.coerce(version));
        return cleanVersion && semver.satisfies(cleanVersion, selectedVersion);
      })
    : versionKeys;

  // Calculate global total downloads
  const globalTotalDownloads = versionKeys.reduce(
    (sum, version) => sum + (packageVersions?.[version]?.downloads || 0),
    0,
  );

  // Group matching versions by next level
  const groupedVersions: Record<string, string[]> = {};
  matchingVersions.forEach((version) => {
    const key = getNextLevelKey(version, selectedVersion);
    if (!groupedVersions[key]) {
      groupedVersions[key] = [];
    }
    groupedVersions[key].push(version);
  });

  // Calculate downloads for each group
  const selectedParts = selectedVersion ? selectedVersion.split('.') : [];
  const isLastLevel = selectedParts.length >= 2; // Patch level or deeper

  const breakdownItems = Object.keys(groupedVersions)
    .map((key) => {
      const versions = groupedVersions[key];
      const downloads = versions.reduce(
        (sum, version) => sum + (packageVersions?.[version]?.downloads || 0),
        0,
      );

      // Find the newest published date in the group
      const newestPublishedAt = versions.reduce<string | null>((newest, version) => {
        const publishedAt = packageVersions?.[version]?.publishedAt;
        if (!publishedAt) {
          return newest;
        }
        if (!newest) {
          return publishedAt;
        }
        return new Date(publishedAt).getTime() > new Date(newest).getTime() ? publishedAt : newest;
      }, null);

      const percentage = globalTotalDownloads > 0 ? (downloads / globalTotalDownloads) * 100 : 0;

      // Extract the relevant version fragment for sorting
      const keyParts = key.split('.');
      const relevantFragment = keyParts[selectedParts.length];
      const sortKey = parseInt(relevantFragment, 10);

      return {
        id: key,
        label: `v${padVersion(key, 'x', key.split('.').length + 1)}`,
        downloads,
        count: versions.length,
        publishedAt: newestPublishedAt,
        nextVersion: isLastLevel ? null : key,
        sortKey,
        percentage,
      };
    })
    .sort((a, b) => b.sortKey - a.sortKey);

  const currentLevel = selectedParts.length;

  return {
    canGoForward: currentLevel < 2,
    breakdownItems,
    globalTotalDownloads,
  };
}

function getHistoricalBreakdownData(
  historicalData: HistoricalData,
  selectedVersion: null | string = null,
): {
  timestamps: Date[];
  series: {
    id: string;
    label: string;
    data: number[];
  }[];
} {
  const versionKeys = Object.keys(historicalData.downloads);

  // Filter versions that match the current selection using semver
  const matchingVersions = selectedVersion
    ? versionKeys.filter((version) => {
        const cleanVersion = semver.valid(semver.coerce(version));
        return cleanVersion && semver.satisfies(cleanVersion, selectedVersion);
      })
    : versionKeys;

  // Group matching versions by next level
  const groupedVersions: Record<string, string[]> = {};
  matchingVersions.forEach((version) => {
    const key = getNextLevelKey(version, selectedVersion);
    if (!groupedVersions[key]) {
      groupedVersions[key] = [];
    }
    groupedVersions[key].push(version);
  });

  const selectedParts = selectedVersion ? selectedVersion.split('.') : [];

  // Generate time series data for each group
  const timeSeriesData = Object.keys(groupedVersions).map((key) => {
    const versions = groupedVersions[key];

    // Aggregate downloads for each timestamp
    const aggregatedData = historicalData.timestamps.map((timestamp, index) =>
      versions.reduce((sum, version) => sum + historicalData.downloads[version][index], 0),
    );

    const keyParts = key.split('.');
    const relevantFragment = keyParts[selectedParts.length];
    const sortKey = parseInt(relevantFragment, 10);

    return {
      id: key,
      label: `v${padVersion(key, 'x', key.split('.').length + 1)}`,
      data: aggregatedData,
      sortKey,
    };
  });

  return {
    timestamps: historicalData.timestamps.map((ts) => new Date(ts)),
    series: timeSeriesData.sort((a, b) => b.sortKey - a.sortKey),
  };
}

function NpmVersionBreakdown({
  packageName,
  selectedVersion,
  onVersionChange,
}: NpmVersionBreakdownProps) {
  // Early return if no package name
  if (!packageName) {
    return null;
  }

  return (
    <Box sx={{ mt: 2 }}>
      {/* Package Info Section */}
      <PackageDetailsSection packageName={packageName} />

      {/* Version Breakdown Section */}
      <PackageVersionsSection
        packageName={packageName}
        selectedVersion={selectedVersion}
        onVersionChange={onVersionChange}
      />
    </Box>
  );
}

export default NpmVersionBreakdown;
