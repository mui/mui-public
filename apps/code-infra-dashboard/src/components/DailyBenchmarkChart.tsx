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
import { useDailyCommits, GitHubCommit } from '../hooks/useDailyCommits';
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

type ChartMode = 'duration' | 'renderCount';

interface DailyReportData {
  date: string;
  commit: GitHubCommit;
  report: BenchmarkReport | null;
}

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

interface DailyBenchmarkChartProps {
  repo: string;
}

export default function DailyBenchmarkChart({ repo }: DailyBenchmarkChartProps) {
  const { dailyCommits, isLoading, isFetchingNextPage, hasNextPage, error, fetchNextPage } =
    useDailyCommits(repo);
  const { reports, isLoading: reportsLoading } = useCiReports(repo, dailyCommits, 'benchmark.json');

  const dailyData: DailyReportData[] = React.useMemo(
    () =>
      dailyCommits.map(({ date, commit }) => ({
        date,
        commit,
        report: reports[commit.sha] ?? null,
      })),
    [dailyCommits, reports],
  );

  const [userSelectedBenchmarks, setUserSelectedBenchmarks] = React.useState<string[] | null>(null);
  const [chartMode, setChartMode] = React.useState<ChartMode>('duration');
  const [yAxisStartAtZero, setYAxisStartAtZero] = React.useState<boolean>(false);
  const [selection, setSelection] = React.useState<{
    report: string | null;
    baseline: string | null;
  }>({ report: null, baseline: null });
  const { report: reportSha, baseline: baselineSha } = selection;

  const allBenchmarks = React.useMemo(() => collectBenchmarkNames(dailyData), [dailyData]);

  const selectedBenchmarks = React.useMemo(
    () => userSelectedBenchmarks ?? allBenchmarks,
    [userSelectedBenchmarks, allBenchmarks],
  );

  const dates = React.useMemo(() => dailyData.map(({ date }) => new Date(date)), [dailyData]);

  const durationSeries = React.useMemo(
    () =>
      selectedBenchmarks.map((name, index) => ({
        label: name,
        data: dailyData.map(({ report }) => report?.[name]?.totalDuration ?? null),
        color: CHART_COLORS[index % CHART_COLORS.length],
      })),
    [dailyData, selectedBenchmarks],
  );

  const renderCountSeries = React.useMemo(
    () =>
      selectedBenchmarks.map((name, index) => ({
        label: name,
        data: dailyData.map(({ report }) => {
          if (!report || !report[name]) {
            return null;
          }
          return report[name].renders.length;
        }),
        color: CHART_COLORS[index % CHART_COLORS.length],
      })),
    [dailyData, selectedBenchmarks],
  );

  const durationChartSeries = React.useMemo(
    () =>
      durationSeries.map(({ label, data, color }) => ({
        label,
        data,
        color,
        connectNulls: false,
        valueFormatter: (value: number | null) => formatMs(value),
      })),
    [durationSeries],
  );

  const reportData = React.useMemo(
    () => (reportSha ? (dailyData.find((item) => item.commit.sha === reportSha) ?? null) : null),
    [reportSha, dailyData],
  );
  const baselineData = React.useMemo(
    () =>
      baselineSha ? (dailyData.find((item) => item.commit.sha === baselineSha) ?? null) : null,
    [baselineSha, dailyData],
  );
  const hasSelection = reportData !== null || baselineData !== null;

  const xAxisFormatter = React.useCallback(
    (date: Date, context: { location: string }) => {
      if (context.location === 'tick') {
        return date.toLocaleDateString();
      }
      const dateString = date.toISOString().split('T')[0];
      const dataPoint = dailyData.find((item) => item.date === dateString);
      const commitSha = dataPoint?.commit?.sha?.substring(0, 7) || '';
      return commitSha ? `${date.toLocaleDateString()} (${commitSha})` : date.toLocaleDateString();
    },
    [dailyData],
  );

  const handleAxisClick = React.useCallback(
    (_event: unknown, data: { dataIndex: number } | null) => {
      if (!data) {
        return;
      }
      const clicked = dailyData[data.dataIndex];
      if (!clicked || !clicked.report) {
        return;
      }
      const clickedSha = clicked.commit.sha;
      const clickedTime = new Date(clicked.date).getTime();
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
        const reportTime = new Date(
          dailyData.find((item) => item.commit.sha === report)?.date ?? 0,
        ).getTime();
        if (clickedTime > reportTime) {
          return { report: clickedSha, baseline: report };
        }
        return { report, baseline: clickedSha };
      });
    },
    [dailyData],
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
            {chartMode === 'duration' && (
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
                series={durationChartSeries}
                onAxisClick={handleAxisClick}
                loading={isLoading || reportsLoading}
                height={300}
                hideLegend
                grid={{ horizontal: true, vertical: true }}
              >
                {baselineData && (
                  <ChartsReferenceLine
                    x={new Date(baselineData.date)}
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
                    x={new Date(reportData.date)}
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

          {chartMode === 'duration' && (
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
                  label={`Report: ${reportData.commit.sha.substring(0, 7)} · ${reportData.date}`}
                  sx={{ color: REPORT_COLOR, borderColor: REPORT_COLOR }}
                  variant="outlined"
                  onDelete={clearReport}
                />
              )}
              {baselineData && (
                <Chip
                  size="small"
                  label={`Baseline: ${baselineData.commit.sha.substring(0, 7)} · ${baselineData.date}`}
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
          )}

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
