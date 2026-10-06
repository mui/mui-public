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
import type {
  BenchmarkRunReport,
  Change,
  MetricComparison,
} from '@mui/internal-benchmark/runReport';
import { isBenchmarkRunUpload } from '@/utils/fetchCiReport';
import { useMasterCommits } from '../hooks/useMasterCommits';
import { useCiReports } from '../hooks/useCiReports';
import ErrorDisplay from './ErrorDisplay';

/**
 * Master history of the `benchmark` CLI reports. Every master commit is benchmarked against its parent
 * in the same run, so each bar is that commit's own paired change — which commit moved a number is
 * read off the chart directly, rather than inferred from a noisy trend.
 */

const CHANGE_COLORS: Record<Change, string> = {
  worse: 'var(--mui-palette-error-main)',
  better: 'var(--mui-palette-success-main)',
  unsure: 'var(--mui-palette-grey-500)',
};

/** Per benchmark, per metric: a commit's change against its parent. */
type CommitComparisons = Map<string, Map<string, MetricComparison>>;

interface CommitPoint {
  sha: string;
  date: Date;
  comparisons: CommitComparisons;
}

// A report is analysed once, however often the list of loaded reports changes around it. Keyed by
// the report object, which the query cache keeps stable for as long as it holds the report.
const comparisonsByReport = new WeakMap<BenchmarkRunReport, CommitComparisons>();

function comparisonsOf(report: BenchmarkRunReport): CommitComparisons {
  let comparisons = comparisonsByReport.get(report);
  if (!comparisons) {
    comparisons = new Map();
    for (const { benchmark, metrics } of analyzeRun(report)) {
      if (benchmark.kind === 'baseline') {
        comparisons.set(
          benchmark.name,
          new Map(metrics.map(({ metric, comparisons: [comparison] }) => [metric, comparison])),
        );
      }
    }
    comparisonsByReport.set(report, comparisons);
  }
  return comparisons;
}

interface BenchmarkRunHistoryProps {
  repo: string;
}

export default function BenchmarkRunHistory({ repo }: BenchmarkRunHistoryProps) {
  const { commits, isLoading, isFetchingNextPage, hasNextPage, error, fetchNextPage } =
    useMasterCommits(repo);
  const { reports, isLoading: reportsLoading } = useCiReports(repo, commits, 'benchmark.json');

  const points = React.useMemo(
    () =>
      commits.flatMap(({ timestamp, commit }): CommitPoint[] => {
        const upload = reports[commit.sha];
        // Version 1 reports are `DailyBenchmarkChart`'s.
        if (!upload || !isBenchmarkRunUpload(upload)) {
          return [];
        }
        return [
          { sha: commit.sha, date: new Date(timestamp), comparisons: comparisonsOf(upload.report) },
        ];
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
  const metric =
    [userMetric, 'render', metricNames[0]].find(
      (name): name is string => name != null && metricNames.includes(name),
    ) ?? null;

  // One series per kind of change, so each bar takes its change's colour. A commit's bar is the
  // midpoint of its confidence interval; the tooltip gives the interval itself.
  const series = React.useMemo(() => {
    const selected = points.map((point) =>
      benchmark === null || metric === null
        ? undefined
        : point.comparisons.get(benchmark)?.get(metric),
    );
    return (['worse', 'better', 'unsure'] as const satisfies Change[]).map((change) => ({
      type: 'bar' as const,
      stack: 'change',
      label: change,
      color: CHANGE_COLORS[change],
      data: selected.map((comparison) =>
        comparison?.change === change
          ? (comparison.relative.low + comparison.relative.high) / 2
          : null,
      ),
      valueFormatter: (_value: number | null, { dataIndex }: { dataIndex: number }) => {
        const comparison = selected[dataIndex];
        return comparison?.change === change ? formatComparison(comparison) : null;
      },
    }));
  }, [points, benchmark, metric]);

  const [selectedSha, setSelectedSha] = React.useState<string | null>(null);

  // A repository still on version 1 reports has nothing to draw here.
  if (!error && !isLoading && !reportsLoading && points.length === 0) {
    return null;
  }

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
              value={metric}
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
