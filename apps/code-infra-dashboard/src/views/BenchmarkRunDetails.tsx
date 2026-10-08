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
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';
import { fetchCiReport, isBenchmarkRunUpload } from '@/utils/fetchCiReport';
import {
  analyzeRun,
  benchmarkTable,
  changeTone,
  comparisonPrecision,
  formatDuration,
  formatRounds,
  runReportFootnote,
} from '@mui/internal-benchmark/runReport';
import type {
  BenchmarkAnalysis,
  BenchmarkRunReport,
  BenchmarkTableColumn,
  ChangeTone,
} from '@mui/internal-benchmark/runReport';
import Heading from '../components/Heading';
import ReportHeader from '../components/ReportHeader';
import ErrorDisplay from '../components/ErrorDisplay';

/** A cell's colours: a tinted background where something needs a look, so the eye finds it. */
function toneSx(tone: ChangeTone): SxProps<Theme> {
  if (tone === 'none') {
    return { color: 'text.secondary' };
  }
  return (theme) => ({
    color: theme.palette[tone].main,
    bgcolor: alpha(theme.palette[tone].main, 0.12),
  });
}

// Fixed widths per kind of column, so the columns of every benchmark's table line up. The label
// column takes what the page has left, down to its minimum, past which the table scrolls sideways.
const COLUMN_WIDTHS: Record<BenchmarkTableColumn['kind'], number> = {
  label: 160,
  value: 120,
  comparison: 280,
};

const PRECISION_WIDTH = 110;

function BenchmarkTable({ analysis }: { analysis: BenchmarkAnalysis }) {
  const { benchmark } = analysis;
  const { columns, rows } = benchmarkTable(analysis);
  const firstComparison = columns.findIndex((column) => column.kind === 'comparison');
  const alignOf = (column: number) => (columns[column].kind === 'value' ? 'right' : undefined);
  const comparisonHeaders = columns
    .filter((column) => column.kind === 'comparison')
    .map((column) => column.header);
  const minWidth =
    columns.reduce((sum, column) => sum + COLUMN_WIDTHS[column.kind], 0) +
    comparisonHeaders.length * PRECISION_WIDTH;

  return (
    <Box sx={{ mb: 4 }}>
      <Typography variant="subtitle1" component="h3">
        {benchmark.name}{' '}
        <Typography component="span" variant="body2" color="text.secondary">
          {benchmark.file} ·{' '}
          <Tooltip
            title={
              benchmark.sampling?.timedOut
                ? 'Still unresolved when the timeout stopped sampling'
                : 'Rounds past the sample size were added while a difference was unresolved'
            }
          >
            <Typography
              component="span"
              variant="body2"
              color={benchmark.sampling?.timedOut ? 'warning.main' : 'text.secondary'}
            >
              {formatRounds(benchmark)}
            </Typography>
          </Tooltip>
        </Typography>
      </Typography>
      {/* Only the table scrolls sideways on a narrow screen; the heading above it stays put. */}
      <TableContainer sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ tableLayout: 'fixed', width: '100%', minWidth }}>
          <colgroup>
            {columns.map((column, index) => (
              <col
                key={index}
                style={column.kind === 'label' ? undefined : { width: COLUMN_WIDTHS[column.kind] }}
              />
            ))}
            {comparisonHeaders.map((header) => (
              <col key={`precision ${header}`} style={{ width: PRECISION_WIDTH }} />
            ))}
          </colgroup>
          <TableHead>
            <TableRow>
              {columns.map(({ header }, column) => (
                <TableCell key={column} align={alignOf(column)}>
                  {header}
                </TableCell>
              ))}
              {comparisonHeaders.map((header) => (
                <TableCell key={`precision ${header}`}>
                  <Tooltip title="The smallest change this run could still have missed: the interval's half-width. Coloured when a regression past the alarm's warn or error band could hide in it.">
                    <span>{comparisonHeaders.length === 1 ? 'Precision' : `${header} ±`}</span>
                  </Tooltip>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row, rowIndex) => (
              <TableRow key={row.metric}>
                {row.cells.map((cell, column) => (
                  <TableCell
                    key={column}
                    align={alignOf(column)}
                    sx={
                      columns[column].kind === 'comparison'
                        ? toneSx(changeTone(row.comparisons[column - firstComparison]))
                        : undefined
                    }
                  >
                    {cell}
                  </TableCell>
                ))}
                {row.comparisons.map((comparison, index) => {
                  const precision = comparisonPrecision(
                    comparison,
                    analysis.metrics[rowIndex].definition,
                  );
                  return (
                    <TableCell key={`precision ${index}`} sx={toneSx(precision.tone)}>
                      <Tooltip title={precision.detail}>
                        <span>{precision.label}</span>
                      </Tooltip>
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
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
              {runReportFootnote(analyses)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {report.durationMs !== undefined && `Ran ${formatDuration(report.durationMs)} · `}
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
