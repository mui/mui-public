'use client';

import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { styled } from '@mui/material/styles';
import Heading from '../components/Heading';
import ErrorDisplay from '../components/ErrorDisplay';
import { fetchBenchmarkReport, BenchmarkReport, RenderStats } from '../utils/fetchBenchmarkReport';

const durationFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: 'percent',
  signDisplay: 'exceptZero',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function formatMs(value: number): string {
  return `${durationFormatter.format(value)} ms`;
}

function formatDiffMs(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${durationFormatter.format(value)} ms`;
}

interface DiffEntry {
  key: string;
  baseDuration: number | null;
  headDuration: number | null;
  baseStdDev: number | null;
  headStdDev: number | null;
  absoluteDiff: number;
  relativeDiff: number | null;
  withinNoise: boolean;
}

function seriesKey(benchmarkName: string, render: RenderStats): string {
  return `${benchmarkName} / ${render.id} / ${render.phase}`;
}

function computeDiffs(
  baseReport: BenchmarkReport | undefined,
  headReport: BenchmarkReport | undefined,
): DiffEntry[] {
  if (!baseReport || !headReport) {
    return [];
  }

  const baseMap = new Map<string, { duration: number; stdDev: number }>();
  const headMap = new Map<string, { duration: number; stdDev: number }>();

  for (const [name, entry] of Object.entries(baseReport)) {
    for (const render of entry.renders) {
      baseMap.set(seriesKey(name, render), {
        duration: render.actualDuration,
        stdDev: render.stdDev,
      });
    }
  }

  for (const [name, entry] of Object.entries(headReport)) {
    for (const render of entry.renders) {
      headMap.set(seriesKey(name, render), {
        duration: render.actualDuration,
        stdDev: render.stdDev,
      });
    }
  }

  const allKeys = new Set([...baseMap.keys(), ...headMap.keys()]);
  const diffs: DiffEntry[] = [];

  for (const key of allKeys) {
    const base = baseMap.get(key);
    const head = headMap.get(key);
    const baseDuration = base?.duration ?? null;
    const headDuration = head?.duration ?? null;
    const baseStdDev = base?.stdDev ?? null;
    const headStdDev = head?.stdDev ?? null;

    const absoluteDiff =
      headDuration !== null && baseDuration !== null ? headDuration - baseDuration : 0;
    const relativeDiff =
      baseDuration !== null && baseDuration !== 0 && headDuration !== null
        ? absoluteDiff / baseDuration
        : null;

    // Within noise if the absolute diff is smaller than the combined std devs
    const combinedStdDev = (baseStdDev ?? 0) + (headStdDev ?? 0);
    const withinNoise = Math.abs(absoluteDiff) <= combinedStdDev;

    diffs.push({
      key,
      baseDuration,
      headDuration,
      baseStdDev,
      headStdDev,
      absoluteDiff,
      relativeDiff,
      withinNoise,
    });
  }

  // Sort by absolute diff descending (biggest regressions first)
  diffs.sort((a, b) => Math.abs(b.absoluteDiff) - Math.abs(a.absoluteDiff));

  return diffs;
}

function diffColor(diff: DiffEntry): string {
  if (diff.withinNoise || diff.absoluteDiff === 0) {
    return 'text.secondary';
  }
  return diff.absoluteDiff > 0 ? 'error.main' : 'success.main';
}

const NoiseChip = styled('span')(({ theme }) => ({
  fontSize: '0.7rem',
  padding: '1px 4px',
  borderRadius: 4,
  backgroundColor: theme.vars.palette.action.hover,
  color: theme.vars.palette.text.secondary,
  marginLeft: theme.spacing(0.5),
}));

export default function BenchmarkComparison() {
  const params = useParams<{ owner: string; repo: string }>();
  const searchParams = useSearchParams();

  if (!params.owner || !params.repo) {
    throw new Error('Missing required path parameters');
  }

  const repo = `${params.owner}/${params.repo}`;
  const baseCommit = searchParams.get('baseCommit');
  const headCommit = searchParams.get('headCommit');

  const {
    data: baseReport,
    isLoading: isBaseLoading,
    error: baseError,
  } = useQuery({
    queryKey: ['benchmark-report', repo, baseCommit],
    queryFn: () => fetchBenchmarkReport(repo, baseCommit!),
    retry: 1,
    enabled: Boolean(baseCommit),
  });

  const {
    data: headReport,
    isLoading: isHeadLoading,
    error: headError,
  } = useQuery({
    queryKey: ['benchmark-report', repo, headCommit],
    queryFn: () => fetchBenchmarkReport(repo, headCommit!),
    retry: 1,
    enabled: Boolean(headCommit),
  });

  const isLoading = isBaseLoading || isHeadLoading;
  const error = baseError || headError;

  const diffs = React.useMemo(() => computeDiffs(baseReport, headReport), [baseReport, headReport]);

  if (!baseCommit || !headCommit) {
    return (
      <React.Fragment>
        <Heading level={1}>Benchmark Comparison</Heading>
        <Paper elevation={2} sx={{ p: 3 }}>
          <Typography color="error">
            Missing required &quot;baseCommit&quot; and &quot;headCommit&quot; query parameters.
          </Typography>
        </Paper>
      </React.Fragment>
    );
  }

  return (
    <React.Fragment>
      <Heading level={1}>Benchmark Comparison</Heading>
      <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Comparing{' '}
          <Link
            href={`https://github.com/${repo}/commit/${baseCommit}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {baseCommit.substring(0, 7)}
          </Link>
          {' → '}
          <Link
            href={`https://github.com/${repo}/commit/${headCommit}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {headCommit.substring(0, 7)}
          </Link>
        </Typography>

        {isLoading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2 }}>
            <CircularProgress size={16} />
            <Typography>Loading benchmark reports...</Typography>
          </Box>
        )}

        {error && <ErrorDisplay title="Error loading benchmark reports" error={error as Error} />}

        {!isLoading && !error && diffs.length === 0 && (
          <Typography color="text.secondary">No comparison data available.</Typography>
        )}

        {!isLoading && !error && diffs.length > 0 && (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Benchmark / Render / Phase</TableCell>
                  <TableCell align="right">Base</TableCell>
                  <TableCell align="right">Head</TableCell>
                  <TableCell align="right">Diff</TableCell>
                  <TableCell align="right">Change</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {diffs.map((diff) => (
                  <TableRow key={diff.key}>
                    <TableCell sx={{ maxWidth: '40ch', wordBreak: 'break-word' }}>
                      {diff.key}
                    </TableCell>
                    <TableCell align="right">
                      {diff.baseDuration !== null ? formatMs(diff.baseDuration) : '—'}
                      {diff.baseStdDev !== null && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          component="span"
                          sx={{ ml: 0.5 }}
                        >
                          ±{formatMs(diff.baseStdDev)}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {diff.headDuration !== null ? formatMs(diff.headDuration) : '—'}
                      {diff.headStdDev !== null && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          component="span"
                          sx={{ ml: 0.5 }}
                        >
                          ±{formatMs(diff.headStdDev)}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right" sx={{ color: diffColor(diff) }}>
                      {diff.absoluteDiff !== 0 ? formatDiffMs(diff.absoluteDiff) : '—'}
                      {diff.withinNoise && diff.absoluteDiff !== 0 && <NoiseChip>noise</NoiseChip>}
                    </TableCell>
                    <TableCell align="right" sx={{ color: diffColor(diff) }}>
                      {diff.relativeDiff !== null
                        ? percentFormatter.format(diff.relativeDiff)
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>
    </React.Fragment>
  );
}
