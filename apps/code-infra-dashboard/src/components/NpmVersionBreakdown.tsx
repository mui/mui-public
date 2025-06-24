import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Link from '@mui/material/Link';
import { Link as RouterLink, useSearchParams } from 'react-router';
import List from '@mui/material/List';
import ListItemText from '@mui/material/ListItemText';
import ListItemButton from '@mui/material/ListItemButton';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import Skeleton from '@mui/material/Skeleton';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { PieChart } from '@mui/x-charts/PieChart';
import { LineChart } from '@mui/x-charts/LineChart';
import * as semver from 'semver';
import { PieItemIdentifier } from '@mui/x-charts';
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

interface BreakdownVisualizationProps {
  state?: BreakdownState | null;
  onItemClick: (nextVersion: string | null) => void;
}

function BreakdownVisualization({ state, onItemClick }: BreakdownVisualizationProps) {
  const [hoveredItem, setHoveredItem] = React.useState<string | null>(null);

  const breakdownItems = state?.breakdownItems ?? [];

  // Generate chart data
  const chartData = breakdownItems.map((item, index) => ({
    id: item.id,
    label: `${item.label} (${item.percentage.toFixed(1)}%)`,
    value: item.downloads,
    color: COLORS[index % COLORS.length],
  }));

  // Handle chart clicks
  const handleChartClick = (event: any, item: PieItemIdentifier) => {
    if (onItemClick && breakdownItems[item.dataIndex]) {
      const breakdownItem = breakdownItems[item.dataIndex];
      if (breakdownItem.nextVersion !== null) {
        onItemClick(breakdownItem.nextVersion);
      }
    }
  };

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
            '& .MuiChartsLegend-root': {
              display: 'none',
            },
          }}
        >
          <PieChart
            series={[{ data: chartData }]}
            width={400}
            height={400}
            onItemClick={state?.canGoForward ? handleChartClick : undefined}
            margin={{ top: 40, right: 40, bottom: 40, left: 40 }}
            loading={!state}
            hideLegend
          />
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <List sx={{ maxHeight: 400, overflow: 'auto' }}>
            {state
              ? state.breakdownItems.map((item, index) => {
                  const color = COLORS[index % COLORS.length];
                  const isHovered = hoveredItem === item.id;
                  const isClickable = item.nextVersion !== null && onItemClick;

                  return (
                    <React.Fragment key={item.id}>
                      <ListItemButton
                        onClick={isClickable ? () => onItemClick!(item.nextVersion) : undefined}
                        disabled={!isClickable}
                        onMouseEnter={() => setHoveredItem(item.id)}
                        onMouseLeave={() => setHoveredItem(null)}
                        sx={{
                          borderRadius: 1,
                          mb: 1,
                          backgroundColor: isHovered ? 'action.hover' : 'transparent',
                          transition: 'background-color 0.2s ease',
                          cursor: isClickable ? 'pointer' : 'default',
                        }}
                      >
                        <Box
                          sx={{
                            width: 16,
                            height: 16,
                            backgroundColor: color,
                            borderRadius: '50%',
                            mr: 2,
                            flexShrink: 0,
                          }}
                        />
                        <ListItemText
                          primary={item.label}
                          secondary={
                            <React.Fragment>
                              {`${item.downloads.toLocaleString()} downloads (${item.percentage.toFixed(1)}%) - last 7 days`}
                              <br />
                              {`Contains ${item.count} version${item.count === 1 ? '' : 's'}`}
                              <br />
                              {item.publishedAt
                                ? `Latest: ${new Date(item.publishedAt).toLocaleDateString()}`
                                : 'Release date unknown'}
                            </React.Fragment>
                          }
                          slotProps={{
                            secondary: { component: 'div' },
                          }}
                        />
                        {isClickable && <ChevronRightIcon color="action" />}
                      </ListItemButton>
                      <Divider />
                    </React.Fragment>
                  );
                })
              : null}
          </List>
        </Box>
      </Box>
    </Box>
  );
}

interface HistoricalTrendsSectionProps {
  packageName: string | null;
  selectedVersion: string | null;
}

function HistoricalTrendsSection({ packageName, selectedVersion }: HistoricalTrendsSectionProps) {
  // Fetch historical data
  const {
    data: historicalChartData = { series: [], timestamps: [] },
    isLoading,
    error: historyError,
  } = useQuery({
    queryKey: ['npmPackageHistory', packageName, selectedVersion],
    queryFn: async () => {
      const packageHistory = await fetchNpmPackageHistory(packageName!);
      return getHistoricalBreakdownData(packageHistory, selectedVersion);
    },
    enabled: !!packageName,
    staleTime: 60 * 60 * 1000, // 1 hour
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
      {historicalChartData ? (
        <LineChart
          series={historicalChartData.series.map((series, index) => ({
            ...series,
            color: COLORS[index % COLORS.length],
          }))}
          xAxis={[
            {
              data: historicalChartData.timestamps,
              scaleType: 'time',
              label: 'Date',
            },
          ]}
          loading={isLoading}
          yAxis={[{ label: 'Downloads' }]}
          height={400}
        />
      ) : (
        <Skeleton variant="rectangular" height={400} />
      )}
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
        <BreakdownVisualization state={isLoading ? null : state} onItemClick={onVersionChange} />
      )}

      {/* Historical Trends */}
      <Box sx={{ mt: 4 }}>
        <Typography variant="h3" sx={{ mb: 2 }}>
          Historical Download Trends
        </Typography>
        <HistoricalTrendsSection packageName={packageName} selectedVersion={selectedVersion} />
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
  };
}

function getHistoricalBreakdownData(
  historicalData: HistoricalData,
  selectedVersion: null | string = null,
): {
  timestamps: number[];
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
    timestamps: historicalData.timestamps,
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
