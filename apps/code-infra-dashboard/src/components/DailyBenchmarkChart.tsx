import * as React from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import { styled } from '@mui/material/styles';
import { LineChart } from '@mui/x-charts-pro/LineChart';
import { ChartsReferenceLine } from '@mui/x-charts-pro/ChartsReferenceLine';
import type { BenchmarkReport } from '@/lib/benchmark/types';
import { formatMs } from '@/utils/formatters';
import { useMasterCommits, type GitHubCommit } from '../hooks/useMasterCommits';
import { useCiReports } from '../hooks/useCiReports';
import ErrorDisplay from './ErrorDisplay';
import { CHART_COLORS } from './chartColors';
import { BenchmarkComparisonReportView } from './BenchmarkComparisonReportView';

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

const BASELINE_COLOR = 'var(--mui-palette-info-main)';
const REPORT_COLOR = 'var(--mui-palette-warning-main)';

type ChartMode = 'duration' | 'renderCount' | 'paint';
type Granularity = 'daily' | 'perCommit';

interface CommitReportData {
  timestamp: number;
  commit: GitHubCommit;
  report: BenchmarkReport | null;
}

function collectBenchmarkNames(chartData: CommitReportData[]): string[] {
  const names = new Set<string>();
  for (const { report } of chartData) {
    if (report) {
      for (const name of Object.keys(report)) {
        names.add(name);
      }
    }
  }
  return Array.from(names).sort();
}

interface DailyBenchmarkChartProps {
  repo: string;
}

export default function DailyBenchmarkChart({ repo }: DailyBenchmarkChartProps) {
  const [userSelectedBenchmarks, setUserSelectedBenchmarks] = React.useState<string[] | null>(null);
  const [chartMode, setChartMode] = React.useState<ChartMode>('duration');
  const [granularity, setGranularity] = React.useState<Granularity>('daily');
  const [yAxisStartAtZero, setYAxisStartAtZero] = React.useState<boolean>(false);
  const [selection, setSelection] = React.useState<{
    report: string | null;
    baseline: string | null;
  }>({ report: null, baseline: null });
  const { report: reportSha, baseline: baselineSha } = selection;

  const { commits, isLoading, isFetchingNextPage, hasNextPage, error, fetchNextPage } =
    useMasterCommits(repo, { groupByDay: granularity === 'daily' });
  const { reports, isLoading: reportsLoading } = useCiReports(repo, commits, 'benchmark.json');

  const chartData: CommitReportData[] = React.useMemo(
    () =>
      commits.map(({ timestamp, commit }) => ({
        timestamp,
        commit,
        report: reports[commit.sha] ?? null,
      })),
    [commits, reports],
  );

  const changeGranularity = React.useCallback((next: Granularity) => {
    setGranularity(next);
    setSelection({ report: null, baseline: null });
  }, []);

  const allBenchmarks = React.useMemo(() => collectBenchmarkNames(chartData), [chartData]);

  const selectedBenchmarks = React.useMemo(
    () => userSelectedBenchmarks ?? allBenchmarks,
    [userSelectedBenchmarks, allBenchmarks],
  );

  const dates = React.useMemo(
    () => chartData.map(({ timestamp }) => new Date(timestamp)),
    [chartData],
  );

  const chartSeries = React.useMemo(() => {
    const valueForMode = (entry: BenchmarkReport[string] | undefined): number | null => {
      if (!entry) {
        return null;
      }
      if (chartMode === 'duration') {
        return entry.totalDuration;
      }
      if (chartMode === 'paint') {
        return entry.metrics['paint:default']?.mean ?? null;
      }
      return entry.renders.length;
    };
    const valueFormatter =
      chartMode === 'renderCount'
        ? (value: number | null) => (value !== null ? `${value} renders` : 'No data')
        : (value: number | null) => formatMs(value);
    return selectedBenchmarks.map((name, index) => ({
      label: name,
      data: chartData.map(({ report }) => valueForMode(report?.[name])),
      color: CHART_COLORS[index % CHART_COLORS.length],
      connectNulls: false,
      valueFormatter,
    }));
  }, [chartMode, chartData, selectedBenchmarks]);

  const reportData = React.useMemo(
    () => (reportSha ? (chartData.find((item) => item.commit.sha === reportSha) ?? null) : null),
    [reportSha, chartData],
  );
  const baselineData = React.useMemo(
    () =>
      baselineSha ? (chartData.find((item) => item.commit.sha === baselineSha) ?? null) : null,
    [baselineSha, chartData],
  );
  const hasSelection = reportData !== null || baselineData !== null;

  const xAxisFormatter = React.useCallback(
    (date: Date, context: { location: string }) => {
      if (context.location === 'tick') {
        return date.toLocaleDateString();
      }
      const dataPoint = chartData.find((item) => item.timestamp === date.getTime());
      const commitSha = dataPoint?.commit?.sha?.substring(0, 7) || '';
      return commitSha ? `${date.toLocaleString()} (${commitSha})` : date.toLocaleString();
    },
    [chartData],
  );

  const handleAxisClick = React.useCallback(
    (_event: unknown, data: { dataIndex: number } | null) => {
      if (!data) {
        return;
      }
      const clicked = chartData[data.dataIndex];
      if (!clicked || !clicked.report) {
        return;
      }
      const clickedSha = clicked.commit.sha;
      const clickedTime = clicked.timestamp;
      // Clicking an already-selected commit clears its slot.
      // Otherwise: if the click is later than the current report, promote (old report → baseline, click → report).
      // If the click is earlier than the current report (or no report yet), it becomes the baseline,
      // unless there's no report at all — then the click becomes the report.
      setSelection(({ report, baseline }) => {
        if (clickedSha === report) {
          return { report: null, baseline };
        }
        if (clickedSha === baseline) {
          return { report, baseline: null };
        }
        if (report === null) {
          return { report: clickedSha, baseline };
        }
        if (baseline !== null) {
          // Both slots filled: start over with the click as the new report.
          return { report: clickedSha, baseline: null };
        }
        const reportTime = chartData.find((item) => item.commit.sha === report)?.timestamp ?? 0;
        if (clickedTime > reportTime) {
          return { report: clickedSha, baseline: report };
        }
        return { report, baseline: clickedSha };
      });
    },
    [chartData],
  );

  const clearSelection = React.useCallback(
    () => setSelection({ report: null, baseline: null }),
    [],
  );

  const clearReport = React.useCallback(
    () => setSelection((prev) => ({ ...prev, report: null })),
    [],
  );
  const clearBaseline = React.useCallback(
    () => setSelection((prev) => ({ ...prev, baseline: null })),
    [],
  );

  const inlinePair = React.useMemo(() => {
    if (!reportData?.report) {
      return null;
    }
    return {
      value: reportData.report,
      base: baselineData?.report ?? null,
      valueCommit: reportData.commit,
      baseCommit: baselineData?.commit ?? null,
    };
  }, [reportData, baselineData]);

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
            Benchmark durations from master branch.
          </Typography>

          <Box sx={{ mb: 3 }}>
            <Typography variant="body2" gutterBottom>
              Select benchmarks to display:
            </Typography>
            <Autocomplete
              multiple
              options={allBenchmarks}
              value={selectedBenchmarks}
              onChange={(_event, newValue) => setUserSelectedBenchmarks(newValue)}
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
                <Typography variant="caption" color="text.secondary">
                  |
                </Typography>
                <ToggleSelectButton
                  variant="text"
                  size="small"
                  onClick={() => setChartMode('paint')}
                  disabled={chartMode === 'paint'}
                >
                  paint
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
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                  Granularity:
                </Typography>
                <ToggleSelectButton
                  variant="text"
                  size="small"
                  onClick={() => changeGranularity('daily')}
                  disabled={granularity === 'daily'}
                >
                  daily
                </ToggleSelectButton>
                <Typography variant="caption" color="text.secondary">
                  |
                </Typography>
                <ToggleSelectButton
                  variant="text"
                  size="small"
                  onClick={() => changeGranularity('perCommit')}
                  disabled={granularity === 'perCommit'}
                >
                  per commit
                </ToggleSelectButton>
              </Box>
            </Box>
          </Box>

          <Box>
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
                  ...(chartMode !== 'renderCount' && {
                    valueFormatter: (value: number) => formatMs(value),
                  }),
                },
              ]}
              series={chartSeries}
              onAxisClick={handleAxisClick}
              loading={isLoading || reportsLoading}
              height={300}
              hideLegend
              grid={{ horizontal: true, vertical: true }}
            >
              {baselineData && (
                <ChartsReferenceLine
                  x={new Date(baselineData.timestamp)}
                  label="Baseline"
                  labelAlign="start"
                  lineStyle={{
                    stroke: BASELINE_COLOR,
                    strokeWidth: 2,
                    strokeDasharray: '4 4',
                  }}
                  labelStyle={{ fill: BASELINE_COLOR, fontSize: 12, fontWeight: 600 }}
                />
              )}
              {reportData && (
                <ChartsReferenceLine
                  x={new Date(reportData.timestamp)}
                  label="Report"
                  labelAlign="start"
                  lineStyle={{
                    stroke: REPORT_COLOR,
                    strokeWidth: 2,
                    strokeDasharray: '4 4',
                  }}
                  labelStyle={{ fill: REPORT_COLOR, fontSize: 12, fontWeight: 600 }}
                />
              )}
            </LineChart>
          </Box>

          <Box
            sx={{
              mt: 2,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              flexWrap: 'wrap',
            }}
          >
            {!hasSelection && (
              <Typography variant="caption" color="text.secondary">
                Click a point to set the report, then click another to set the baseline.
              </Typography>
            )}
            {reportData && (
              <Chip
                size="small"
                label={`Report: ${reportData.commit.sha.substring(0, 7)} · ${new Date(reportData.timestamp).toLocaleString()}`}
                sx={{ color: REPORT_COLOR, borderColor: REPORT_COLOR }}
                variant="outlined"
                onDelete={clearReport}
              />
            )}
            {baselineData && (
              <Chip
                size="small"
                label={`Baseline: ${baselineData.commit.sha.substring(0, 7)} · ${new Date(baselineData.timestamp).toLocaleString()}`}
                sx={{ color: BASELINE_COLOR, borderColor: BASELINE_COLOR }}
                variant="outlined"
                onDelete={clearBaseline}
              />
            )}
            {hasSelection && (
              <Button size="small" onClick={clearSelection}>
                Clear
              </Button>
            )}
          </Box>

          {inlinePair && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="subtitle1" gutterBottom>
                {inlinePair.baseCommit
                  ? `Comparing baseline ${inlinePair.baseCommit.sha.substring(0, 7)} → report ${inlinePair.valueCommit.sha.substring(0, 7)}`
                  : `Report ${inlinePair.valueCommit.sha.substring(0, 7)}`}
              </Typography>
              <BenchmarkComparisonReportView value={inlinePair.value} base={inlinePair.base} />
            </Box>
          )}

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
