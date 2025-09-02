import * as React from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import { styled } from '@mui/material/styles';
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
 * Styled toggle button for chart controls
 */
const ToggleSelectButton = styled(Button)(({ theme }) => ({
  minWidth: 'auto',
  padding: 0,
  fontSize: '0.75rem',
  textDecoration: 'underline',
  color: theme.palette.primary.main,
  textTransform: 'none',
  '&:disabled': {
    color: theme.palette.text.secondary,
    textDecoration: 'none',
  },
}));

/**
 * Determines if a bundle name represents a top-level package
 * @param importSrc The bundle/package name
 * @returns true if it's a top-level package, false for sub-packages
 */
function isPackageTopLevel(importSrc: string): boolean {
  if (importSrc.startsWith('_') || importSrc.startsWith('virtual:')) {
    return false;
  }
  const parts = importSrc.split('/');
  return parts.length === 1 || (parts.length === 2 && parts[0].startsWith('@'));
}

interface DailyBundleSizeChartProps {
  repo: string;
}

type SizeType = 'gzip' | 'parsed';

interface ChartData {
  dates: Date[];
  series: Array<{
    label: string;
    data: (number | null)[];
    color: string;
  }>;
}

function transformDataForChart(dailyData: DailyCommitData[], sizeType: SizeType): ChartData {
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
        return snapshot[bundleName][sizeType]; // Use selected size type
      }),
      color: CHART_COLORS[index % CHART_COLORS.length],
    }));

  return { dates, series };
}

export default function DailyBundleSizeChart({ repo }: DailyBundleSizeChartProps) {
  const { dailyData, isLoading, isFetchingNextPage, hasNextPage, error, fetchNextPage } =
    useDailyCommitHistory(repo);
  const [selectedBundles, setSelectedBundles] = React.useState<string[]>([]);
  const [sizeType, setSizeType] = React.useState<SizeType>('gzip');
  const [yAxisStartAtZero, setYAxisStartAtZero] = React.useState<boolean>(false);

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
    const topLevelBundles = allBundles.filter(isPackageTopLevel);
    setSelectedBundles(topLevelBundles);
  }, [allBundles]);

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

  console.log(dailyData);
  const chartData = transformDataForChart(dailyData, sizeType);

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

  return (
    <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
      <Typography variant="h6" component="h2" gutterBottom>
        Daily Bundle Size Trends
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Bundle sizes ({sizeType === 'gzip' ? 'gzipped' : 'parsed'}) for the first commit of each day
        from master branch. Showing {chartData.dates.length} days of data.
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
            sx={{ mb: 1 }}
          />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, mb: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                Size type:
              </Typography>
              <ToggleSelectButton
                variant="text"
                size="small"
                onClick={() => setSizeType('gzip')}
                disabled={sizeType === 'gzip'}
              >
                gzipped
              </ToggleSelectButton>
              <Typography variant="caption" color="text.secondary">
                |
              </Typography>
              <ToggleSelectButton
                variant="text"
                size="small"
                onClick={() => setSizeType('parsed')}
                disabled={sizeType === 'parsed'}
              >
                parsed
              </ToggleSelectButton>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                Y-axis:
              </Typography>
              <ToggleSelectButton
                variant="text"
                size="small"
                onClick={() => setYAxisStartAtZero(true)}
                disabled={yAxisStartAtZero}
              >
                start at zero
              </ToggleSelectButton>
              <Typography variant="caption" color="text.secondary">
                |
              </Typography>
              <ToggleSelectButton
                variant="text"
                size="small"
                onClick={() => setYAxisStartAtZero(false)}
                disabled={!yAxisStartAtZero}
              >
                auto scale
              </ToggleSelectButton>
            </Box>
          </Box>
        </Box>
      )}

      <Box>
        <LineChart
          xAxis={[
            {
              data: chartData.dates,
              scaleType: 'time',
              valueFormatter: (date: Date) => date.toLocaleDateString(),
            },
          ]}
          yAxis={[
            {
              ...(yAxisStartAtZero && { min: 0 }),
              width: 60,
              valueFormatter: (value: number) => byteSizeFormatter.format(value),
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
          height={300}
          hideLegend
          grid={{ horizontal: true, vertical: true }}
        />
      </Box>

      {hasNextPage && (
        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}>
          <Button
            variant="outlined"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            startIcon={isFetchingNextPage ? <CircularProgress size={16} /> : undefined}
          >
            {isFetchingNextPage ? 'Loading more...' : 'Load More Historical Data'}
          </Button>
        </Box>
      )}
    </Paper>
  );
}
