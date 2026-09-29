'use client';

import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { fetchCiReport, isBenchmarkRunUpload } from '@/utils/fetchCiReport';
import { analyzeRun, formatComparison, formatValue } from '@mui/internal-benchmark/runReport';
import type {
  BenchmarkAnalysis,
  BenchmarkRunReport,
  MetricComparison,
} from '@mui/internal-benchmark/runReport';
import Heading from '../components/Heading';
import ReportHeader from '../components/ReportHeader';
import ErrorDisplay from '../components/ErrorDisplay';

/** A regression is coloured by severity; `better` is green; `unsure` is the expected result. */
function comparisonColor(comparison: MetricComparison): string {
  if (comparison.severity === 'error') {
    return 'error';
  }
  if (comparison.severity === 'warning') {
    return 'warning.main';
  }
  return comparison.change === 'better' ? 'success.main' : 'text.secondary';
}

function BenchmarkTable({ analysis }: { analysis: BenchmarkAnalysis }) {
  const { benchmark, metrics } = analysis;
  const comparisons = metrics[0]?.comparisons ?? [];

  return (
    <TableContainer sx={{ mb: 4, overflowX: 'auto' }}>
      <Typography variant="subtitle1" component="h3">
        {benchmark.name}{' '}
        <Typography component="span" variant="body2" color="text.secondary">
          {benchmark.file}
        </Typography>
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Metric</TableCell>
            {benchmark.variants.map((variant) => (
              <TableCell key={variant} align="right">
                {variant}
              </TableCell>
            ))}
            {comparisons.map(({ subject, against }) => (
              <TableCell key={`${subject}:${against}`}>
                {benchmark.kind === 'baseline' ? `Δ vs ${against}` : `${subject} vs ${against}`}
              </TableCell>
            ))}
            <TableCell align="right">Rounds</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {metrics.map(({ metric, definition, variants, comparisons: metricComparisons }) => (
            <TableRow key={metric}>
              <TableCell>{metric}</TableCell>
              {benchmark.variants.map((variant) => (
                <TableCell key={variant} align="right">
                  {formatValue(variants[variant].median, definition)}
                </TableCell>
              ))}
              {metricComparisons.map((comparison) => (
                <TableCell key={`${comparison.subject}:${comparison.against}`}>
                  <Typography variant="body2" component="span" color={comparisonColor(comparison)}>
                    {formatComparison(comparison)}
                  </Typography>
                </TableCell>
              ))}
              <TableCell align="right">{variants[benchmark.variants[0]].count}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export default function BenchmarkRunDetails() {
  const params = useParams<{ owner: string; repo: string }>();
  const searchParams = useSearchParams();

  if (!params.owner || !params.repo) {
    throw new Error('Missing required path parameters');
  }

  const repo = `${params.owner}/${params.repo}`;
  const sha = searchParams.get('sha');
  const prNumber = searchParams.get('prNumber');

  const {
    data: report,
    isLoading,
    error,
  } = useQuery<BenchmarkRunReport | null>({
    queryKey: ['benchmark-run-report', repo, sha],
    queryFn: async () => {
      const upload = await fetchCiReport(repo, sha!, 'benchmark.json');
      return upload && isBenchmarkRunUpload(upload) ? upload.report : null;
    },
    retry: 1,
    enabled: Boolean(sha),
  });

  const analyses = React.useMemo(() => (report ? analyzeRun(report) : []), [report]);

  if (!sha) {
    return (
      <React.Fragment>
        <Heading level={1}>Benchmark run</Heading>
        <Paper elevation={2} sx={{ p: 3 }}>
          <Typography color="error">Missing required &quot;sha&quot; query parameter.</Typography>
        </Paper>
      </React.Fragment>
    );
  }

  // The run measured its own baseline, so it is one of the report's builds rather than a separately
  // fetched report.
  const baseline = report?.builds.baseline;

  return (
    <React.Fragment>
      <Heading level={1}>Benchmark run</Heading>

      <ReportHeader
        repo={repo}
        sha={sha}
        baseSha={baseline?.sha ?? null}
        prNumber={prNumber ? Number(prNumber) : undefined}
        baseRef={baseline?.label}
      />

      <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
        {isLoading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <CircularProgress size={16} />
            <Typography>Loading benchmark report…</Typography>
          </Box>
        )}

        {error && <ErrorDisplay title="Error loading benchmark report" error={error as Error} />}

        {!isLoading && !error && !report && (
          <Alert severity="info">No benchmark report found for this commit.</Alert>
        )}

        {analyses
          .filter((analysis) => analysis.benchmark.error)
          .map(({ benchmark }) => (
            <Alert key={benchmark.name} severity="warning" sx={{ mb: 2 }}>
              <strong>{benchmark.name}</strong>: {benchmark.error}
            </Alert>
          ))}

        {analyses
          .filter((analysis) => !analysis.benchmark.error)
          .map((analysis) => (
            <BenchmarkTable key={analysis.benchmark.name} analysis={analysis} />
          ))}

        {report && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              Each value is a median. Each Δ is a 95% confidence interval on the paired per-round
              difference, relative to the variant it is measured against; &quot;unsure&quot; means
              it straddles zero.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {report.sampling.samples} rounds after {report.sampling.warmup} warmup ·{' '}
              {report.environment.browser} on {report.environment.platform}/
              {report.environment.arch}
              {report.environment.launchArgs.length > 0 &&
                ` · ${report.environment.launchArgs.join(' ')}`}
            </Typography>
          </Box>
        )}
      </Paper>
    </React.Fragment>
  );
}
