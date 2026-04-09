import * as React from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import { styled } from '@mui/material/styles';
import { LineChart } from '@mui/x-charts-pro/LineChart';
import { BarChart } from '@mui/x-charts-pro/BarChart';
import { useDailyCommits, GitHubCommit } from '../hooks/useDailyCommits';
import { useCiReports } from '../hooks/useCiReports';
import type { BenchmarkReport, BenchmarkReportEntry } from '../utils/fetchBenchmarkReport';
import ErrorDisplay from './ErrorDisplay';

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

const durationFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMs(value: number | null): string {
  if (value === null) {
    return 'No data';
  }
  return `${durationFormatter.format(value)} ms`;
}

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

type ChartMode = 'duration' | 'renderCount';

interface DailyReportData {
  date: string;
  commit: GitHubCommit;
  report: BenchmarkReport | null;
}

/**
 * Build a unique series key from benchmark name, render id, and phase.
 */
function seriesKey(benchmarkName: string, renderId: string, phase: string): string {
  return `${benchmarkName} / ${renderId} / ${phase}`;
}

/**
 * Collect all unique benchmark names across daily data.
 */
function collectBenchmarkNames(dailyData: DailyReportData[]): string[] {
  const names = new Set<string>();
  for (const { report } of dailyData) {
    if (report) {
      for (const name of Object.keys(report)) {
        names.add(name);
      }
    }
  }
  return Array.from(names).sort();
}

/**
 * Collect all unique series keys for a set of selected benchmarks.
 */
function collectSeriesKeys(dailyData: DailyReportData[], selectedBenchmarks: string[]): string[] {
  const keys = new Set<string>();
  const selectedSet = new Set(selectedBenchmarks);
  for (const { report } of dailyData) {
    if (!report) {
      continue;
    }
    for (const [name, entry] of Object.entries(report)) {
      if (!selectedSet.has(name)) {
        continue;
      }
      for (const render of entry.renders) {
        keys.add(seriesKey(name, render.id, render.phase));
      }
    }
  }
  return Array.from(keys).sort();
}

/**
 * Build a map of series key -> render stats for a single report entry.
 */
function entryRenderMap(benchmarkName: string, entry: BenchmarkReportEntry): Map<string, number> {
  const map = new Map<string, number>();
  for (const render of entry.renders) {
    map.set(seriesKey(benchmarkName, render.id, render.phase), render.actualDuration);
  }
  return map;
}

interface DailyBenchmarkChartProps {
  repo: string;
}

export default function DailyBenchmarkChart({ repo }: DailyBenchmarkChartProps) {
  const { dailyCommits, isLoading, isFetchingNextPage, hasNextPage, error, fetchNextPage } =
    useDailyCommits(repo);
  const { reports, isLoading: reportsLoading } = useCiReports(
    repo,
    dailyCommits,
    'benchmark.json',
  );

  const dailyData: DailyReportData[] = React.useMemo(
    () =>
      dailyCommits.map(({ date, commit }) => ({
        date,
        commit,
        report: reports[commit.sha] ?? null,
      })),
    [dailyCommits, reports],
  );

  const [selectedBenchmarks, setSelectedBenchmarks] = React.useState<string[]>([]);
  const [chartMode, setChartMode] = React.useState<ChartMode>('duration');
  const [yAxisStartAtZero, setYAxisStartAtZero] = React.useState<boolean>(false);

  const allBenchmarks = React.useMemo(() => collectBenchmarkNames(dailyData), [dailyData]);

  // Auto-select all benchmarks when data loads
  React.useEffect(() => {
    setSelectedBenchmarks(allBenchmarks);
  }, [allBenchmarks]);

  const dates = React.useMemo(() => dailyData.map(({ date }) => new Date(date)), [dailyData]);

  const isSingleBenchmark = selectedBenchmarks.length === 1;

  // Duration chart: line chart (multiple benchmarks) or stacked bar (single benchmark)
  const durationSeries = React.useMemo(() => {
    const keys = collectSeriesKeys(dailyData, selectedBenchmarks);
    return keys.map((key, index) => ({
      label: key,
      data: dailyData.map(({ report }) => {
        if (!report) {
          return null;
        }
        for (const [name, entry] of Object.entries(report)) {
          const map = entryRenderMap(name, entry);
          const val = map.get(key);
          if (val !== undefined) {
            return val;
          }
        }
        return null;
      }),
      color: CHART_COLORS[index % CHART_COLORS.length],
    }));
  }, [dailyData, selectedBenchmarks]);

  // Render count chart series: one line per benchmark
  const renderCountSeries = React.useMemo(() => {
    return selectedBenchmarks.map((name, index) => ({
      label: name,
      data: dailyData.map(({ report }) => {
        if (!report || !report[name]) {
          return null;
        }
        return report[name].renders.length;
      }),
      color: CHART_COLORS[index % CHART_COLORS.length],
    }));
  }, [dailyData, selectedBenchmarks]);

  const xAxisFormatter = React.useCallback(
    (date: Date, context: { location: string }) => {
      if (context.location === 'tick') {
        return date.toLocaleDateString();
      }
      const dateString = date.toISOString().split('T')[0];
      const dataPoint = dailyData.find((d) => d.date === dateString);
      const commitSha = dataPoint?.commit?.sha?.substring(0, 7) || '';
      return commitSha ? `${date.toLocaleDateString()} (${commitSha})` : date.toLocaleDateString();
    },
    [dailyData],
  );

  return (
    <Paper elevation={2} sx={{ p: 3 }}>
      <Typography variant="h6" component="h2" gutterBottom>
        Daily benchmark trends
      </Typography>

      {error ? (
        <ErrorDisplay title="Error loading benchmark history" error={error} />
      ) : (
        <React.Fragment>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Benchmark durations for the first commit of each day from master branch.
          </Typography>

          <Box sx={{ mb: 3 }}>
            <Typography variant="body2" gutterBottom>
              Select benchmarks to display:
            </Typography>
            <Autocomplete
              multiple
              options={allBenchmarks}
              value={selectedBenchmarks}
              onChange={(event, newValue) => setSelectedBenchmarks(newValue)}
              filterSelectedOptions
              size="small"
              renderInput={(params) => (
                <TextField {...params} placeholder="Search and select benchmarks..." />
              )}
              sx={{ mb: 1 }}
            />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, mb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                  View:
                </Typography>
                <ToggleSelectButton
                  variant="text"
                  size="small"
                  onClick={() => setChartMode('duration')}
                  disabled={chartMode === 'duration'}
                >
                  duration
                </ToggleSelectButton>
                <Typography variant="caption" color="text.secondary">
                  |
                </Typography>
                <ToggleSelectButton
                  variant="text"
                  size="small"
                  onClick={() => setChartMode('renderCount')}
                  disabled={chartMode === 'renderCount'}
                >
                  render count
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
            {chartMode === 'duration' && isSingleBenchmark && (
              <BarChart
                xAxis={[
                  {
                    data: dates,
                    scaleType: 'band',
                    valueFormatter: (date: Date) => {
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
                    ...(yAxisStartAtZero && { min: 0 }),
                    width: 60,
                    valueFormatter: (value: number) => formatMs(value),
                  },
                ]}
                series={durationSeries.map(({ label, data, color }) => ({
                  label,
                  data,
                  color,
                  stack: 'duration',
                  valueFormatter: (value: number | null) => formatMs(value),
                }))}
                loading={isLoading || reportsLoading}
                height={300}
                hideLegend
                grid={{ horizontal: true, vertical: true }}
              />
            )}
            {chartMode === 'duration' && !isSingleBenchmark && (
              <LineChart
                xAxis={[
                  {
                    data: dates,
                    scaleType: 'time',
                    valueFormatter: xAxisFormatter,
                  },
                ]}
                yAxis={[
                  {
                    ...(yAxisStartAtZero && { min: 0 }),
                    width: 60,
                    valueFormatter: (value: number) => formatMs(value),
                  },
                ]}
                series={durationSeries.map(({ label, data, color }) => ({
                  label,
                  data,
                  color,
                  connectNulls: false,
                  valueFormatter: (value: number | null) => formatMs(value),
                }))}
                loading={isLoading || reportsLoading}
                height={300}
                hideLegend
                grid={{ horizontal: true, vertical: true }}
              />
            )}
            {chartMode === 'renderCount' && (
              <LineChart
                xAxis={[
                  {
                    data: dates,
                    scaleType: 'time',
                    valueFormatter: xAxisFormatter,
                  },
                ]}
                yAxis={[
                  {
                    ...(yAxisStartAtZero && { min: 0 }),
                    width: 60,
                  },
                ]}
                series={renderCountSeries.map(({ label, data, color }) => ({
                  label,
                  data,
                  color,
                  connectNulls: false,
                  valueFormatter: (value: number | null) =>
                    value !== null ? `${value} renders` : 'No data',
                }))}
                loading={isLoading || reportsLoading}
                height={300}
                hideLegend
                grid={{ horizontal: true, vertical: true }}
              />
            )}
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
