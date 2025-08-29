import * as React from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import { LineChart } from '@mui/x-charts/LineChart';
import { byteSizeFormatter } from './SizeChangeDisplay';
import { useDailyCommitHistory, DailyCommitData } from '../hooks/useDailyCommitHistory';

// Color palette for different bundle series
const CHART_COLORS = [
  '#1976d2', // Blue
  '#d32f2f', // Red
  '#2e7d32', // Green
  '#ed6c02', // Orange
  '#9c27b0', // Purple
  '#00796b', // Teal
  '#f57c00', // Amber
  '#5d4037', // Brown
];

/**
 * Determines if a bundle name represents a top-level package
 * @param importSrc The bundle/package name
 * @returns true if it's a top-level package, false for sub-packages
 */
function isPackageTopLevel(importSrc: string): boolean {
  const parts = importSrc.split('/');
  return parts.length === 1 || (parts.length === 2 && parts[0].startsWith('@'));
}

interface DailyBundleSizeChartProps {
  repo: string;
}

interface ChartData {
  dates: Date[];
  series: Array<{
    label: string;
    data: (number | null)[];
    color: string;
  }>;
}

function transformDataForChart(dailyData: DailyCommitData[]): ChartData {
  if (dailyData.length === 0) {
    return { dates: [], series: [] };
  }

  // Get all unique bundle names from all snapshots
  const bundleNames = new Set<string>();
  dailyData.forEach(({ snapshot }) => {
    if (snapshot) {
      Object.keys(snapshot).forEach((name) => bundleNames.add(name));
    }
  });

  const dates = dailyData.map(({ date }) => new Date(date));

  const series = Array.from(bundleNames)
    .sort() // Sort bundle names for consistent ordering
    .map((bundleName, index) => ({
      label: bundleName,
      data: dailyData.map(({ snapshot }) => {
        if (!snapshot || !snapshot[bundleName]) {
          return null; // Missing data point
        }
        return snapshot[bundleName].gzip; // Use gzipped size
      }),
      color: CHART_COLORS[index % CHART_COLORS.length],
    }));

  return { dates, series };
}

export default function DailyBundleSizeChart({ repo }: DailyBundleSizeChartProps) {
  const { dailyData, isLoading, error } = useDailyCommitHistory(repo);
  const [selectedBundles, setSelectedBundles] = React.useState<string[]>([]);

  // Get all available bundle names from the data
  const allBundles = React.useMemo(() => {
    const bundleNames = new Set<string>();
    dailyData.forEach(({ snapshot }) => {
      if (snapshot) {
        Object.keys(snapshot).forEach((name) => bundleNames.add(name));
      }
    });
    return Array.from(bundleNames).sort();
  }, [dailyData]);

  // Initialize selected bundles with top-level packages when data loads
  React.useEffect(() => {
    if (allBundles.length > 0 && selectedBundles.length === 0) {
      const topLevelBundles = allBundles.filter(isPackageTopLevel);
      setSelectedBundles(topLevelBundles);
    }
  }, [allBundles, selectedBundles.length]);

  if (isLoading) {
    return (
      <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" component="h2" gutterBottom>
          Daily Bundle Size Trends
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 4 }}>
          <CircularProgress size={20} />
          <Typography>Loading bundle size history...</Typography>
        </Box>
      </Paper>
    );
  }

  if (error) {
    return (
      <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" component="h2" gutterBottom>
          Daily Bundle Size Trends
        </Typography>
        <Box sx={{ p: 2, color: 'error.main' }}>
          <Typography variant="subtitle1" gutterBottom>
            Error loading bundle size history
          </Typography>
          <Typography variant="body2">{error.message || 'Unknown error occurred'}</Typography>
        </Box>
      </Paper>
    );
  }

  const chartData = transformDataForChart(dailyData);

  if (chartData.dates.length === 0) {
    return (
      <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" component="h2" gutterBottom>
          Daily Bundle Size Trends
        </Typography>
        <Box sx={{ p: 2, color: 'text.secondary' }}>
          <Typography>No bundle size data available for recent commits.</Typography>
        </Box>
      </Paper>
    );
  }

  // Filter series based on selected bundles
  const validSeries = chartData.series.filter((series) => selectedBundles.includes(series.label));

  if (validSeries.length === 0) {
    return (
      <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" component="h2" gutterBottom>
          Daily Bundle Size Trends
        </Typography>

        {allBundles.length > 0 && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="body2" gutterBottom>
              Select bundles to display:
            </Typography>
            <Autocomplete
              multiple
              options={allBundles}
              value={selectedBundles}
              onChange={(event, newValue) => setSelectedBundles(newValue)}
              filterSelectedOptions
              renderInput={(params) => (
                <TextField {...params} placeholder="Search and select bundles..." size="small" />
              )}
              sx={{ mb: 2 }}
            />
          </Box>
        )}

        <Box sx={{ p: 2, color: 'text.secondary' }}>
          <Typography>
            {selectedBundles.length === 0
              ? 'Please select at least one bundle to display the chart.'
              : 'No valid bundle size data available for the selected bundles.'}
          </Typography>
        </Box>
      </Paper>
    );
  }

  return (
    <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
      <Typography variant="h6" component="h2" gutterBottom>
        Daily Bundle Size Trends
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Bundle sizes (gzipped) for the first commit of each day from master branch. Showing{' '}
        {chartData.dates.length} days of data.
      </Typography>

      {allBundles.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" gutterBottom>
            Select bundles to display:
          </Typography>
          <Autocomplete
            multiple
            options={allBundles}
            value={selectedBundles}
            onChange={(event, newValue) => setSelectedBundles(newValue)}
            filterSelectedOptions
            renderInput={(params) => (
              <TextField {...params} placeholder="Search and select bundles..." size="small" />
            )}
            sx={{ mb: 2 }}
          />
          <Typography variant="caption" color="text.secondary">
            Showing {selectedBundles.length} of {allBundles.length} bundles
            {selectedBundles.length > 0 && ` (${validSeries.length} with data)`}
          </Typography>
        </Box>
      )}

      <Box sx={{ width: '100%', height: 400 }}>
        <LineChart
          xAxis={[
            {
              data: chartData.dates,
              scaleType: 'time',
              valueFormatter: (date: Date) => date.toLocaleDateString(),
            },
          ]}
          series={validSeries.map(({ label, data, color }) => ({
            label,
            data,
            color,
            connectNulls: false, // Don't connect across missing data points
            valueFormatter: (value: number | null) =>
              value ? byteSizeFormatter.format(value) : 'No data',
          }))}
          height={400}
          margin={{ top: 20, right: 30, bottom: 60, left: 80 }}
          hideLegend
          grid={{ horizontal: true, vertical: true }}
        />
      </Box>
    </Paper>
  );
}
