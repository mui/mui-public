import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Grid from '@mui/material/Grid';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Link from '@mui/material/Link';
import { Link as RouterLink, useSearchParams } from 'react-router';
import List from '@mui/material/List';
import ListItemText from '@mui/material/ListItemText';
import ListItemButton from '@mui/material/ListItemButton';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { PieChart } from '@mui/x-charts/PieChart';
import * as semver from 'semver';
import { PieItemIdentifier } from '@mui/x-charts';
import { Package } from '../hooks/useNpmPackage';

interface NpmVersionBreakdownProps {
  packageData: Package;
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
  packageData: Package,
  selectedVersion: null | string = null,
): BreakdownState {
  const versionKeys = Object.keys(packageData.versions || {});

  // Filter versions that match the current selection using semver
  const matchingVersions = selectedVersion
    ? versionKeys.filter((version) => {
        const cleanVersion = semver.valid(semver.coerce(version));
        return cleanVersion && semver.satisfies(cleanVersion, selectedVersion);
      })
    : versionKeys;

  // Calculate global total downloads
  const globalTotalDownloads = versionKeys.reduce(
    (sum, version) => sum + (packageData.versions?.[version]?.downloads || 0),
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
        (sum, version) => sum + (packageData.versions?.[version]?.downloads || 0),
        0,
      );

      // Find the newest published date in the group
      const newestPublishedAt = versions.reduce<string | null>((newest, version) => {
        const publishedAt = packageData.versions?.[version]?.publishedAt;
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

function NpmVersionBreakdown({
  packageData,
  selectedVersion,
  onVersionChange,
}: NpmVersionBreakdownProps) {
  const [searchParams] = useSearchParams();
  if (!packageData.versions) {
    return (
      <Alert severity="info" sx={{ mt: 2 }}>
        No version data available for this package
      </Alert>
    );
  }

  const versionKeys = Object.keys(packageData.versions);

  // Check if we have download data
  const hasDownloadData = versionKeys.some(
    (version) => packageData.versions?.[version]?.downloads !== undefined,
  );

  if (!hasDownloadData) {
    return (
      <Alert severity="error" sx={{ mt: 2 }}>
        Download statistics are not available for this package. This could be because the package
        has no recent downloads or the npm API is not responding.
      </Alert>
    );
  }

  // Get current breakdown state
  const state = getBreakdownState(packageData, selectedVersion);
  const filteredBreakdown = state.breakdownItems.filter((item) => item.downloads > 0);

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

  // Generate chart data
  const chartData = filteredBreakdown.map((item, index) => ({
    id: item.id,
    label: `${item.label} (${item.percentage.toFixed(1)}%)`,
    value: item.downloads,
    color: COLORS[index % COLORS.length],
  }));

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
      <Typography variant="h2">Version Breakdown</Typography>

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

      {filteredBreakdown.length > 0 ? (
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Box sx={{ height: 400 }}>
              <PieChart
                series={[{ data: chartData }]}
                height={400}
                onItemClick={state.canGoForward ? handleChartClick : undefined}
                hideLegend
              />
            </Box>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <List sx={{ maxHeight: 350, overflow: 'auto' }}>
              {state.breakdownItems.map((item) => (
                <React.Fragment key={item.id}>
                  <ListItemButton
                    component={item.nextVersion !== null ? RouterLink : 'div'}
                    to={item.nextVersion !== null ? createVersionUrl(item.nextVersion) : undefined}
                    disabled={item.nextVersion === null}
                    sx={{ borderRadius: 1, mb: 1 }}
                  >
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
              ))}
            </List>
          </Grid>
        </Grid>
      ) : (
        <Alert severity="info">No version data available</Alert>
      )}
    </Box>
  );
}

export default NpmVersionBreakdown;
