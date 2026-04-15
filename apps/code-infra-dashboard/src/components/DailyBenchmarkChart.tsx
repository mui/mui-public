import * as React from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Autocomplete from '@mui/material/Autocomplete';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import { styled } from '@mui/material/styles';
import { BarChartPro } from '@mui/x-charts-pro/BarChartPro';
import { useXScale, useDrawingArea } from '@mui/x-charts-pro/hooks';
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

interface SelectedBarMarkerProps {
  x: Date;
  label: string;
  color: string;
}

/**
 * Drop-in replacement for ChartsReferenceLine that outlines the band of a
 * selected bar instead of drawing a vertical line at its left edge.
 */
function SelectedBarMarker({ x, label, color }: SelectedBarMarkerProps) {
  const xScale = useXScale<'band'>();
  const { top, height } = useDrawingArea();
  const left = xScale(x);
  if (left === undefined) {
    return null;
  }
  const bandwidth = xScale.bandwidth();
  const padding = 3;
  const rectX = left - padding;
  const rectY = top - padding;
  const rectWidth = bandwidth + padding * 2;
  const rectHeight = height + padding * 2;
  return (
    <g pointerEvents="none">
      <rect
        x={rectX}
        y={rectY}
        width={rectWidth}
        height={rectHeight}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeDasharray="4 4"
        rx={2}
      />
      <text
        x={rectX + rectWidth / 2}
        y={rectY - 4}
        fill={color}
        fontSize={12}
        fontWeight={600}
        textAnchor="middle"
      >
        {label}
      </text>
    </g>
  );
}

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
  const [showMissing, setShowMissing] = React.useState<boolean>(true);
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

  const valueForMode = React.useCallback(
    (entry: BenchmarkReport[string] | undefined): number | null => {
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
    },
    [chartMode],
  );

  const visibleChartData = React.useMemo(() => {
    if (showMissing) {
      return chartData;
    }
    return chartData.filter(({ report }) =>
      selectedBenchmarks.some((name) => valueForMode(report?.[name]) !== null),
    );
  }, [chartData, selectedBenchmarks, showMissing, valueForMode]);

  const { xAxisDates, dateBySha } = React.useMemo(() => {
    const dates: Date[] = [];
    const bySha = new Map<string, Date>();
    for (const item of visibleChartData) {
      const date = new Date(item.timestamp);
      dates.push(date);
      bySha.set(item.commit.sha, date);
    }
    return { xAxisDates: dates, dateBySha: bySha };
  }, [visibleChartData]);

  const chartSeries = React.useMemo(() => {
    const valueFormatter =
      chartMode === 'renderCount'
        ? (value: number | null) => (value !== null ? `${value} renders` : 'No data')
        : (value: number | null) => formatMs(value);
    return selectedBenchmarks.map((name, index) => ({
      type: 'bar' as const,
      stack: 'total',
      label: name,
      data: visibleChartData.map(({ report }) => valueForMode(report?.[name])),
      color: CHART_COLORS[index % CHART_COLORS.length],
      valueFormatter,
    }));
  }, [chartMode, visibleChartData, selectedBenchmarks, valueForMode]);

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

  const baselineMarkerDate = baselineSha ? dateBySha.get(baselineSha) : undefined;
  const reportMarkerDate = reportSha ? dateBySha.get(reportSha) : undefined;

  const xAxisFormatter = React.useCallback(
    (date: Date, context: { location: string }) => {
      if (context.location === 'tick') {
        return date.toLocaleDateString();
      }
      const dataPoint = visibleChartData.find((item) => item.timestamp === date.getTime());
      const commitSha = dataPoint?.commit?.sha?.substring(0, 7) || '';
      return commitSha ? `${date.toLocaleString()} (${commitSha})` : date.toLocaleString();
    },
    [visibleChartData],
  );

  const handleAxisClick = React.useCallback(
    (_event: unknown, data: { dataIndex: number } | null) => {
      if (!data) {
        return;
      }
      const clicked = visibleChartData[data.dataIndex];
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
    [visibleChartData, chartData],
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
            Stacked benchmark metrics per commit from master branch.
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
                  Missing data:
                </Typography>
                <ToggleSelectButton
                  variant="text"
                  size="small"
                  onClick={() => setShowMissing(true)}
                  disabled={showMissing}
                >
                  show
                </ToggleSelectButton>
                <Typography variant="caption" color="text.secondary">
                  |
                </Typography>
                <ToggleSelectButton
                  variant="text"
                  size="small"
                  onClick={() => setShowMissing(false)}
                  disabled={!showMissing}
                >
                  hide
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
            <BarChartPro
              xAxis={[
                {
                  data: xAxisDates,
                  scaleType: 'band',
                  valueFormatter: xAxisFormatter,
                  // `ordinalTimeTicks` is a pro feature supported at runtime in
                  // @mui/x-charts-pro@9.0.0-alpha.2 but not yet in the shipped .d.ts.
                  ordinalTimeTicks: ['years', 'quarterly', 'months', 'weeks', 'days'],
                } as NonNullable<React.ComponentProps<typeof BarChartPro>['xAxis']>[number],
              ]}
              yAxis={[
                {
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
              skipAnimation
              grid={{ horizontal: true }}
            >
              {baselineMarkerDate && (
                <SelectedBarMarker x={baselineMarkerDate} label="Baseline" color={BASELINE_COLOR} />
              )}
              {reportMarkerDate && (
                <SelectedBarMarker x={reportMarkerDate} label="Report" color={REPORT_COLOR} />
              )}
            </BarChartPro>
          </Box>

          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}>
            <Button
              variant="outlined"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage || !hasNextPage}
              loading={isFetchingNextPage}
            >
              Load More
            </Button>
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
            {baselineData && (
              <Chip
                size="small"
                label={`Baseline: ${baselineData.commit.sha.substring(0, 7)} · ${new Date(baselineData.timestamp).toLocaleString()}`}
                sx={{ color: BASELINE_COLOR, borderColor: BASELINE_COLOR }}
                variant="outlined"
                onDelete={clearBaseline}
              />
            )}
            {baselineData && reportData && (
              <Typography variant="body2" color="text.secondary" aria-hidden>
                →
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
        </React.Fragment>
      )}
    </Paper>
  );
}
