import * as React from 'react';
import NextLink from 'next/link';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { BarChartPro } from '@mui/x-charts-pro/BarChartPro';
import { analyzeRun, formatComparison } from '@mui/internal-benchmark/runReport';
import type { MetricComparison } from '@mui/internal-benchmark/runReport';
import { useMasterCommits } from '../hooks/useMasterCommits';
import { useCiReports } from '../hooks/useCiReports';
import ErrorDisplay from './ErrorDisplay';

/**
 * Master history of `benchmark run` reports. Every master commit is benchmarked against its parent
 * in the same run, so each bar is that commit's own paired change — which commit moved a number is
 * read off the chart directly, rather than inferred from a noisy trend.
 */

type Change = MetricComparison['change'];

const CHANGE_COLORS: Record<Change, string> = {
  worse: 'var(--mui-palette-error-main)',
  better: 'var(--mui-palette-success-main)',
  unsure: 'var(--mui-palette-grey-500)',
};

interface CommitPoint {
  sha: string;
  date: Date;
  /** Per benchmark, per metric: this commit's change against its parent. */
  comparisons: Map<string, Map<string, MetricComparison>>;
}

interface BenchmarkRunHistoryProps {
  repo: string;
}

export default function BenchmarkRunHistory({ repo }: BenchmarkRunHistoryProps) {
  const { commits, isLoading, isFetchingNextPage, hasNextPage, error, fetchNextPage } =
    useMasterCommits(repo);
  const { reports, isLoading: reportsLoading } = useCiReports(repo, commits, 'benchmark-run.json');

  const points = React.useMemo(
    () =>
      commits.flatMap(({ timestamp, commit }): CommitPoint[] => {
        const report = reports[commit.sha];
        if (!report) {
          return [];
        }
        const comparisons = new Map<string, Map<string, MetricComparison>>();
        for (const { benchmark, metrics } of analyzeRun(report)) {
          if (benchmark.kind !== 'baseline') {
            continue;
          }
          comparisons.set(
            benchmark.name,
            new Map(metrics.map(({ metric, comparisons: [comparison] }) => [metric, comparison])),
          );
        }
        return [{ sha: commit.sha, date: new Date(timestamp), comparisons }];
      }),
    [commits, reports],
  );

  const benchmarkNames = React.useMemo(
    () => [...new Set(points.flatMap((point) => [...point.comparisons.keys()]))].sort(),
    [points],
  );
  const [userBenchmark, setUserBenchmark] = React.useState<string | null>(null);
  const benchmark = userBenchmark ?? benchmarkNames[0] ?? null;

  const metricNames = React.useMemo(
    () =>
      benchmark === null
        ? []
        : [
            ...new Set(
              points.flatMap((point) => [...(point.comparisons.get(benchmark)?.keys() ?? [])]),
            ),
          ],
    [points, benchmark],
  );
  const [userMetric, setUserMetric] = React.useState<string | null>(null);
  const metric = userMetric !== null && metricNames.includes(userMetric) ? userMetric : 'render';

  const comparisonAt = (point: CommitPoint) =>
    benchmark === null ? undefined : point.comparisons.get(benchmark)?.get(metric);

  // One series per kind of change, so each bar takes its change's colour. A commit's bar is the
  // midpoint of its confidence interval; the tooltip gives the interval itself.
  const series = (['worse', 'better', 'unsure'] as const).map((change) => ({
    type: 'bar' as const,
    stack: 'change',
    label: change,
    color: CHANGE_COLORS[change],
    data: points.map((point) => {
      const comparison = comparisonAt(point);
      return comparison?.change === change
        ? (comparison.relative.low + comparison.relative.high) / 2
        : null;
    }),
    valueFormatter: (_value: number | null, { dataIndex }: { dataIndex: number }) => {
      const comparison = comparisonAt(points[dataIndex]);
      return comparison?.change === change ? formatComparison(comparison) : null;
    },
  }));

  const [selectedSha, setSelectedSha] = React.useState<string | null>(null);

  return (
    <Paper elevation={2} sx={{ p: 3, mt: 3 }}>
      <Typography variant="h6" component="h2" gutterBottom>
        Benchmark runs
      </Typography>

      {error ? (
        <ErrorDisplay title="Error loading benchmark history" error={error} />
      ) : (
        <React.Fragment>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Each master commit against its parent, measured in the same run: the midpoint of the 95%
            confidence interval on the paired change. Click a bar to open that run.
          </Typography>

          <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
            <Autocomplete
              options={benchmarkNames}
              value={benchmark}
              onChange={(_event, value) => setUserBenchmark(value)}
              size="small"
              sx={{ minWidth: 320 }}
              renderInput={(inputParams) => <TextField {...inputParams} label="Benchmark" />}
            />
            <Autocomplete
              options={metricNames}
              value={metricNames.includes(metric) ? metric : null}
              onChange={(_event, value) => setUserMetric(value)}
              size="small"
              sx={{ minWidth: 200 }}
              renderInput={(inputParams) => <TextField {...inputParams} label="Metric" />}
            />
          </Box>

          <BarChartPro
            xAxis={[
              {
                data: points.map((point) => point.date),
                scaleType: 'band',
                valueFormatter: (date: Date, context: { location: string }) =>
                  context.location === 'tick'
                    ? date.toLocaleDateString()
                    : `${date.toLocaleString()} (${
                        points.find((point) => point.date === date)?.sha.slice(0, 7) ?? ''
                      })`,
              },
            ]}
            yAxis={[{ width: 60, valueFormatter: (value: number) => `${value.toFixed(1)}%` }]}
            series={series}
            onAxisClick={(_event, data) => {
              if (data) {
                setSelectedSha(points[data.dataIndex]?.sha ?? null);
              }
            }}
            loading={isLoading || reportsLoading}
            height={300}
            skipAnimation
            grid={{ horizontal: true }}
          />

          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between', gap: 2 }}>
            <Typography variant="body2">
              {selectedSha ? (
                <Link component={NextLink} href={`/benchmark-run/${repo}?sha=${selectedSha}`}>
                  Open the run for {selectedSha.slice(0, 7)}
                </Link>
              ) : null}
            </Typography>
            {hasNextPage && (
              <Button size="small" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
                {isFetchingNextPage ? 'Loading…' : 'Load older commits'}
              </Button>
            )}
          </Box>
        </React.Fragment>
      )}
    </Paper>
  );
}
