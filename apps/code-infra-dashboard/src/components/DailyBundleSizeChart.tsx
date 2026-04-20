import * as React from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import { styled } from '@mui/material/styles';
import { LineChart } from '@mui/x-charts-pro/LineChart';
import { byteSizeFormatter } from './SizeChangeDisplay';
import { useDailyCommits } from '../hooks/useDailyCommits';
import { useCiReports } from '../hooks/useCiReports';
import ErrorDisplay from './ErrorDisplay';
import { CHART_COLORS } from './chartColors';

type SizeSnapshot = Record<string, { parsed: number; gzip: number }>;

interface DailyCommitData {
  date: string;
  commit: ReturnType<typeof useDailyCommits>['dailyCommits'][number]['commit'];
  snapshot: SizeSnapshot | null;
}

/**
 * Styled toggle button for chart controls
 */
const ToggleSelectButton = styled(Button)(({ theme }) => ({
  minWidth: 'auto',
  padding: 0,
  fontSize: '0.75rem',
  textDecoration: 'underline',
  color: theme.vars.palette.primary.main,
  textTransform: 'none',
  '&:disabled': {
    color: theme.vars.palette.text.secondary,
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
const MIN_AUTO_Y_AXIS_RANGE = 1024;

interface ChartData {
  dates: Date[];
  series: Array<{
    label: string;
    data: (number | null)[];
    color: string;
  }>;
}

function transformDataForChart(
  dailyData: DailyCommitData[],
  sizeType: SizeType,
  allBundles: string[],
): ChartData {
  if (dailyData.length === 0) {
    return { dates: [], series: [] };
  }

  const dates = dailyData.map(({ date }) => new Date(date));

  const series = allBundles.map((bundleName, index) => ({
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
  const { dailyCommits, isLoading, isFetchingNextPage, hasNextPage, error, fetchNextPage } =
    useDailyCommits(repo);
  const { reports, isLoading: reportsLoading } = useCiReports(
    repo,
    dailyCommits,
    'size-snapshot.json',
  );

  const dailyData: DailyCommitData[] = React.useMemo(
    () =>
      dailyCommits.map(({ date, commit }) => ({
        date,
        commit,
        snapshot: reports[commit.sha] ?? null,
      })),
    [dailyCommits, reports],
  );

  const [selectedBundles, setSelectedBundles] = React.useState<string[]>([]);
  const [sizeType, setSizeType] = React.useState<SizeType>('gzip');
  const [yAxisStartAtZero, setYAxisStartAtZero] = React.useState<boolean>(false);

  // Get all available bundle names from the data
  const allBundles = React.useMemo(() => {
    const bundleNames = new Set<string>(
      dailyData.flatMap(({ snapshot }) => (snapshot ? Object.keys(snapshot) : [])),
    );
    return Array.from(bundleNames).sort();
  }, [dailyData]);

  // Initialize selected bundles with top-level packages when data loads
  React.useEffect(() => {
    const topLevelBundles = allBundles.filter(isPackageTopLevel);
    setSelectedBundles(topLevelBundles);
  }, [allBundles]);

  const chartData = transformDataForChart(dailyData, sizeType, allBundles);

  // Filter series based on selected bundles
  const validSeries = chartData.series.filter((series) => selectedBundles.includes(series.label));

  const autoScaleYAxisLimits = React.useMemo(() => {
    const values = validSeries.flatMap((series) =>
      series.data.filter((value): value is number => value !== null),
    );

    if (values.length === 0) {
      return {};
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;

    if (range >= MIN_AUTO_Y_AXIS_RANGE) {
      return {};
    }

    const padding = (MIN_AUTO_Y_AXIS_RANGE - range) / 2;
    const adjustedMin = Math.max(0, min - padding);

    return {
      min: adjustedMin,
      max: adjustedMin + MIN_AUTO_Y_AXIS_RANGE,
    };
  }, [validSeries]);

  return (
    <Paper elevation={2} sx={{ p: 3 }}>
      <Typography variant="h6" component="h2" gutterBottom>
        Daily bundle size trends
      </Typography>

      {error ? (
        <ErrorDisplay title="Error loading bundle size history" error={error} />
      ) : (
        <React.Fragment>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Bundle sizes ({sizeType === 'gzip' ? 'gzipped' : 'parsed'}) for the first commit of each
            day from master branch.
          </Typography>

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
              size="small"
              renderInput={(params) => (
                <TextField {...params} placeholder="Search and select bundles..." />
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

          <Box>
            <LineChart
              xAxis={[
                {
                  data: chartData.dates,
                  scaleType: 'time',
                  valueFormatter: (date: Date, context) => {
                    if (context.location === 'tick') {
                      return date.toLocaleDateString();
                    }
                    // For tooltip, find the corresponding commit data
                    const dateString = date.toISOString().split('T')[0];
                    const dataPoint = dailyData.find((d) => d.date === dateString);
                    const commitSha = dataPoint?.commit?.sha?.substring(0, 7) || '';
                    return commitSha
                      ? `${date.toLocaleDateString()} (${commitSha})`
                      : date.toLocaleDateString();
                  },
                },
              ]}
              yAxis={[
                {
                  ...(yAxisStartAtZero ? { min: 0 } : autoScaleYAxisLimits),
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
              loading={isLoading || reportsLoading}
              height={300}
              hideLegend
              grid={{ horizontal: true, vertical: true }}
            />
          </Box>

          <Box sx={{ m: 3, display: 'flex', justifyContent: 'center' }}>
            <Button
              variant="outlined"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage || !hasNextPage}
              loading={isFetchingNextPage}
            >
              Load More
            </Button>
          </Box>
        </React.Fragment>
      )}
    </Paper>
  );
}
