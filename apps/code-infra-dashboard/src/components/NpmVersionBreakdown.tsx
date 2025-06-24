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
} from '../lib/npm';
import { useNpmPackage } from '../hooks/useNpmPackage';

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
        {packageDetails ? packageDetails.name : <Skeleton width={200} />}
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

interface NpmVersionBreakdownProps {
  packageName: string | null;
  selectedVersion?: string | null;
  onVersionChange: (version: string | null) => void;
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
  canGoBack: boolean;
  canGoForward: boolean;
  breadcrumbs: BreadcrumbItem[];
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

  return {
    breadcrumbs,
    canGoBack: currentLevel > 0,
    canGoForward: currentLevel < 2,
    breakdownItems,
    globalTotalDownloads,
  };
}

function getHistoricalBreakdownData(
  historicalData: HistoricalData,
  selectedVersion: null | string = null,
): Array<{
  id: string;
  label: string;
  data: Array<{ timestamp: number; totalDownloads: number }>;
}> {
  if (!historicalData || !historicalData.timestamps.length) {
    return [];
  }

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
    const aggregatedData = historicalData.timestamps.map((timestamp, index) => {
      const totalDownloads = versions.reduce(
        (sum, version) => sum + historicalData.downloads[version][index],
        0,
      );

      return {
        timestamp,
        totalDownloads,
      };
    });

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

  return timeSeriesData.sort((a, b) => b.sortKey - a.sortKey);
}

function NpmVersionBreakdown({
  packageName,
  selectedVersion,
  onVersionChange,
}: NpmVersionBreakdownProps) {
  const [searchParams] = useSearchParams();
  const [hoveredItem, setHoveredItem] = React.useState<string | null>(null);
  const listItemRefs = React.useRef<Record<string, HTMLElement | null>>({});

  // Fetch version data
  const {
    data: versions = {},
    isLoading: isLoadingVersions,
    error: versionsError,
  } = useQuery({
    queryKey: ['npmPackageVersions', packageName],
    queryFn: () => fetchNpmPackageVersions(packageName!),
    enabled: !!packageName,
    staleTime: 10 * 60 * 1000, // 10 minutes
  });

  // Fetch historical data
  const {
    data: historicalData = null,
    isLoading: isLoadingHistory,
    error: historyError,
  } = useQuery({
    queryKey: ['npmPackageHistory', packageName],
    queryFn: () => fetchNpmPackageHistory(packageName!),
    enabled: !!packageName,
    staleTime: 60 * 60 * 1000, // 1 hour
  });

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

  // Get current breakdown state (only if we have version data)
  const state =
    Object.keys(versions).length > 0 ? getBreakdownState(versions, selectedVersion) : null;
  const filteredBreakdown = state ? state.breakdownItems.filter((item) => item.downloads > 0) : [];

  // Generate chart data
  const chartData = filteredBreakdown.map((item, index) => ({
    id: item.id,
    label: `${item.label} (${item.percentage.toFixed(1)}%)`,
    value: item.downloads,
    color: COLORS[index % COLORS.length],
  }));

  // Generate historical chart data
  const historicalChartData = historicalData
    ? getHistoricalBreakdownData(historicalData, selectedVersion)
    : [];
  const hasHistoricalData = historicalData && historicalChartData.length > 0;

  // Handle clicks
  const handleItemClick = (nextVersion: string | null) => {
    onVersionChange(nextVersion);
  };

  const handleChartClick = (event: any, item: PieItemIdentifier) => {
    if (filteredBreakdown[item.dataIndex]) {
      const breakdownItem = filteredBreakdown[item.dataIndex];
      if (breakdownItem.nextVersion !== null) {
        handleItemClick(breakdownItem.nextVersion);
      }
    }
  };

  return (
    <Box sx={{ mt: 2 }}>
      {/* Package Info Section */}
      <PackageDetailsSection packageName={packageName} />

      <Typography variant="h3" sx={{ mb: 2 }}>
        Version Breakdown
      </Typography>

      {/* Breadcrumbs - only show if we have state */}
      {state && (
        <Breadcrumbs aria-label="version navigation" sx={{ mb: 2 }}>
          {state.breadcrumbs.map((breadcrumb, index) =>
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
      )}

      {/* Current Data Section */}
      {isLoadingVersions ? (
        <Box sx={{ mb: 4 }}>
          <Skeleton variant="text" width="40%" height={30} sx={{ mb: 2 }} />
          <Box sx={{ display: 'flex', gap: 3, flexDirection: { xs: 'column', md: 'row' } }}>
            <Skeleton variant="circular" width={400} height={400} />
            <Box sx={{ flex: 1 }}>
              <Skeleton variant="rectangular" height={400} />
            </Box>
          </Box>
        </Box>
      ) : versionsError ? (
        <Alert severity="error" sx={{ mb: 4 }}>
          Failed to load version data: {versionsError.message}
        </Alert>
      ) : filteredBreakdown.length > 0 ? (
        <Box sx={{ mb: hasHistoricalData || isLoadingHistory ? 4 : 0 }}>
          {/* Current Data: Pie Chart + List */}
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
                margin={{ top: 40, bottom: 40, left: 40, right: 40 }}
                onItemClick={state.canGoForward ? handleChartClick : undefined}
                onHighlightChange={(highlightedItem) => {
                  if (highlightedItem === null || highlightedItem.dataIndex === undefined) {
                    setHoveredItem(null);
                  } else {
                    const item = filteredBreakdown[highlightedItem.dataIndex];
                    const itemId = item?.id || null;
                    setHoveredItem(itemId);

                    // Scroll the corresponding list item into view
                    if (itemId && listItemRefs.current[itemId]) {
                      listItemRefs.current[itemId]?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'nearest',
                        inline: 'nearest',
                      });
                    }
                  }
                }}
                hideLegend
              />
            </Box>

            <Box sx={{ flex: 1, minWidth: 0 }}>
              <List sx={{ maxHeight: 400, overflow: 'auto' }}>
                {state.breakdownItems.map((item, index) => {
                  const color = COLORS[index % COLORS.length];
                  const isHovered = hoveredItem === item.id;

                  return (
                    <React.Fragment key={item.id}>
                      <ListItemButton
                        ref={(el: HTMLElement | null) => {
                          listItemRefs.current[item.id] = el;
                        }}
                        component={item.nextVersion !== null ? RouterLink : 'div'}
                        to={
                          item.nextVersion !== null ? createVersionUrl(item.nextVersion) : undefined
                        }
                        disabled={item.nextVersion === null}
                        onMouseEnter={() => setHoveredItem(item.id)}
                        onMouseLeave={() => setHoveredItem(null)}
                        sx={{
                          borderRadius: 1,
                          mb: 1,
                          backgroundColor: isHovered ? 'action.hover' : 'transparent',
                          transition: 'background-color 0.2s ease',
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
                        {item.nextVersion !== null && <ChevronRightIcon color="action" />}
                      </ListItemButton>
                      <Divider />
                    </React.Fragment>
                  );
                })}
              </List>
            </Box>
          </Box>
        </Box>
      ) : Object.keys(versions).length === 0 && !isLoadingVersions ? (
        <Alert severity="info" sx={{ mb: 4 }}>
          No version data available for this package
        </Alert>
      ) : (
        <Alert severity="info" sx={{ mb: 4 }}>
          No download statistics available
        </Alert>
      )}

      {/* Historical Data Section */}
      <Box>
        <Typography variant="h3" sx={{ mb: 2 }}>
          Historical Download Trends
        </Typography>

        {isLoadingHistory ? (
          <Box sx={{ width: '100%', height: 400 }}>
            <Skeleton variant="rectangular" height={400} />
          </Box>
        ) : historyError ? (
          <Alert severity="error">Failed to load historical data: {historyError.message}</Alert>
        ) : hasHistoricalData && historicalChartData.length > 0 ? (
          <Box sx={{ width: '100%', height: 400 }}>
            <LineChart
              series={historicalChartData.map((series, index) => ({
                id: series.id,
                label: series.label,
                data: series.data.map((point) => point.totalDownloads),
                color: COLORS[index % COLORS.length],
              }))}
              xAxis={[
                {
                  data: historicalChartData[0]?.data.map((point) => new Date(point.timestamp)),
                  scaleType: 'time',
                  label: 'Date',
                },
              ]}
              yAxis={[
                {
                  label: 'Downloads',
                },
              ]}
              height={400}
            />
          </Box>
        ) : (
          <Alert severity="info">No historical data available for this package</Alert>
        )}
      </Box>
    </Box>
  );
}

export default NpmVersionBreakdown;
