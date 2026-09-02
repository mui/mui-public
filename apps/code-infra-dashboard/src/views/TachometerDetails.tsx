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
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { fetchCiReport } from '@/utils/fetchCiReport';
import type {
  ConfidenceInterval,
  TachometerCaseResult,
  TachometerMeasurementResult,
  TachometerUpload,
  Verdict,
} from '@/lib/tachometer/types';
import Heading from '../components/Heading';
import ReportHeader from '../components/ReportHeader';
import ErrorDisplay from '../components/ErrorDisplay';

/**
 * Deliberately plain: every number the report holds, as tables.
 *
 * No charts or bars. A confidence interval is two numbers and a verdict, and drawing it as a length
 * invites reading the picture as significance when the interval is what actually carries that.
 */

function formatMean(interval: ConfidenceInterval): string {
  return `${interval.low.toFixed(2)} – ${interval.high.toFixed(2)} ms`;
}

function formatPercent(interval: ConfidenceInterval): string {
  const signed = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
  return `${signed(interval.low)} – ${signed(interval.high)}`;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

/** Only a regression is coloured; `unsure` is the expected result and stays neutral. */
function verdictColor(verdict: Verdict): 'error' | 'success' | 'text.secondary' {
  if (verdict === 'slower') {
    return 'error';
  }
  if (verdict === 'faster') {
    return 'success';
  }
  return 'text.secondary';
}

function shortNameOf(caseName: string, variant: string): string {
  return variant.startsWith(`${caseName} `) ? variant.slice(caseName.length + 1) : variant;
}

interface CaseTableProps {
  entry: TachometerCaseResult & { measurements: TachometerMeasurementResult[] };
}

function CaseTable({ entry }: CaseTableProps) {
  return (
    <Box sx={{ mb: 4 }}>
      <Heading level={2}>{entry.name}</Heading>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Measurement</TableCell>
            <TableCell>Variant</TableCell>
            <TableCell align="right">Mean (95% CI)</TableCell>
            <TableCell>vs reference</TableCell>
            <TableCell align="right">Samples</TableCell>
            <TableCell align="right">Transferred</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {entry.measurements.flatMap((measurement) => {
            const byVariant = new Map(
              measurement.comparisons.map((comparison) => [comparison.variant, comparison]),
            );
            return measurement.variants.map((variant) => {
              const comparison = byVariant.get(variant.variant);
              const isReference = variant.variant === entry.reference;
              return (
                <TableRow key={`${measurement.name}-${variant.variant}`}>
                  <TableCell>{measurement.name}</TableCell>
                  <TableCell>{shortNameOf(entry.name, variant.variant)}</TableCell>
                  <TableCell align="right">{formatMean(variant.meanMs)}</TableCell>
                  <TableCell>
                    {isReference ? (
                      <Typography variant="body2" color="text.secondary">
                        reference
                      </Typography>
                    ) : (
                      comparison && (
                        <Typography variant="body2" color={verdictColor(comparison.verdict)}>
                          {comparison.verdict} {formatPercent(comparison.percentChange)}
                        </Typography>
                      )
                    )}
                  </TableCell>
                  <TableCell align="right">{variant.samples}</TableCell>
                  <TableCell align="right">{formatBytes(variant.bytesSent)}</TableCell>
                </TableRow>
              );
            });
          })}
        </TableBody>
      </Table>
    </Box>
  );
}

export default function TachometerDetails() {
  const params = useParams<{ owner: string; repo: string }>();
  const searchParams = useSearchParams();

  if (!params.owner || !params.repo) {
    throw new Error('Missing required path parameters');
  }

  const repo = `${params.owner}/${params.repo}`;
  const sha = searchParams.get('sha');
  const prNumber = searchParams.get('prNumber');

  const {
    data: upload,
    isLoading,
    error,
  } = useQuery<TachometerUpload | null>({
    queryKey: ['tachometer-report', repo, sha],
    queryFn: () => fetchCiReport(repo, sha!, 'tachometer.json'),
    retry: 1,
    enabled: Boolean(sha),
  });

  if (!sha) {
    return (
      <React.Fragment>
        <Heading level={1}>Tachometer Details</Heading>
        <Paper elevation={2} sx={{ p: 3 }}>
          <Typography color="error">Missing required &quot;sha&quot; query parameter.</Typography>
        </Paper>
      </React.Fragment>
    );
  }

  const report = upload?.report;
  const summarized = (report?.cases ?? []).filter(
    (entry): entry is TachometerCaseResult & { measurements: TachometerMeasurementResult[] } =>
      entry.measurements !== undefined && entry.measurements.length > 0,
  );
  const failed = (report?.cases ?? []).filter((entry) => !entry.measurements?.length);

  // A tachometer report carries its own comparison, so the baseline is one of its own refs rather
  // than a separately fetched report.
  const baselineRef = report?.refs.find((ref) => ref.kind !== 'worktree');

  return (
    <React.Fragment>
      <Heading level={1}>Tachometer Details</Heading>

      <ReportHeader
        repo={repo}
        sha={sha}
        baseSha={baselineRef?.sha ?? null}
        prNumber={prNumber ? Number(prNumber) : undefined}
        baseRef={upload?.branch ?? undefined}
      />

      <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
        {isLoading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <CircularProgress size={16} />
            <Typography>Loading tachometer report…</Typography>
          </Box>
        )}

        {error && <ErrorDisplay title="Error loading tachometer report" error={error as Error} />}

        {!isLoading && !error && !report && (
          <Alert severity="info">No tachometer report found for this commit.</Alert>
        )}

        {failed.map((entry) => (
          <Alert key={entry.name} severity="warning" sx={{ mb: 2 }}>
            <strong>{entry.name}</strong>: {entry.error ?? 'produced no result'}
          </Alert>
        ))}

        {summarized.map((entry) => (
          <CaseTable key={entry.name} entry={entry} />
        ))}

        {report && (
          <Typography variant="body2" color="text.secondary">
            Each cell is a 95% confidence interval for the mean; one sample is one page load.
            &quot;unsure&quot; means the interval still straddles zero — the expected result for two
            equivalent builds. Measured on the production bundle, installed from a packed tarball.
          </Typography>
        )}
      </Paper>
    </React.Fragment>
  );
}
