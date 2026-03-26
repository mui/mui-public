'use client';

import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import NextLink from 'next/link';
import { useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { styled } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import Heading from '../components/Heading';
import ErrorDisplay from '../components/ErrorDisplay';
import {
  fetchBenchmarkReport,
  type BenchmarkReport,
  type BenchmarkReportEntry,
  type RenderStats,
} from '../utils/fetchBenchmarkReport';
import { useGitHubPR } from '../hooks/useGitHubPR';
import { useCompareCommits } from '../hooks/useCompareCommits';

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
  baseReport: BenchmarkReport | null | undefined,
  headReport: BenchmarkReport | null | undefined,
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

const PHASE_COLORS: Record<string, string> = {
  mount: '#1976d2',
  update: '#2e7d32',
  'nested-update': '#ed6c02',
};

const BAR_WIDTH = 20;
const BAR_GAP = 2;
const CHART_HEIGHT = 48;

function RenderBarChart({
  entry,
  globalMaxDuration,
}: {
  entry: BenchmarkReportEntry;
  globalMaxDuration: number;
}) {
  return (
    <Box sx={{ overflowX: 'auto', mb: 1 }}>
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'flex-end',
          gap: `${BAR_GAP}px`,
          height: CHART_HEIGHT,
        }}
      >
        {entry.renders.map((render) => {
          const height =
            globalMaxDuration > 0
              ? (render.actualDuration / globalMaxDuration) * CHART_HEIGHT
              : 0;
          return (
            <Tooltip
              key={`${render.id}-${render.phase}`}
              title={`${render.id} (${render.phase}): ${formatMs(render.actualDuration)}`}
              arrow
            >
              <Box
                sx={{
                  width: BAR_WIDTH,
                  height: Math.max(height, 2),
                  backgroundColor: PHASE_COLORS[render.phase] ?? '#9c27b0',
                  borderRadius: '2px 2px 0 0',
                  flexShrink: 0,
                }}
              />
            </Tooltip>
          );
        })}
      </Box>
    </Box>
  );
}

function BenchmarkEntryDetail({
  name,
  entry,
  globalMaxDuration,
}: {
  name: string;
  entry: BenchmarkReportEntry;
  globalMaxDuration: number;
}) {
  return (
    <Paper elevation={1} sx={{ p: 2, mb: 2 }}>
      <Typography variant="subtitle1" gutterBottom fontWeight={600}>
        {name}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {entry.iterations} iterations, total {formatMs(entry.totalDuration)}
      </Typography>

      <RenderBarChart entry={entry} globalMaxDuration={globalMaxDuration} />

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Render ID</TableCell>
              <TableCell>Phase</TableCell>
              <TableCell align="right">Duration</TableCell>
              <TableCell align="right">Std Dev</TableCell>
              <TableCell align="right">Raw Mean</TableCell>
              <TableCell align="right">Iterations</TableCell>
              <TableCell align="right">Outliers</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {entry.renders.map((render: RenderStats) => (
              <TableRow key={`${render.id}-${render.phase}`}>
                <TableCell>{render.id}</TableCell>
                <TableCell>
                  <Box
                    component="span"
                    sx={{
                      display: 'inline-block',
                      width: 10,
                      height: 10,
                      borderRadius: '2px',
                      backgroundColor: PHASE_COLORS[render.phase] ?? '#9c27b0',
                      mr: 0.75,
                      verticalAlign: 'middle',
                    }}
                  />
                  {render.phase}
                </TableCell>
                <TableCell align="right">{formatMs(render.actualDuration)}</TableCell>
                <TableCell align="right">{formatMs(render.stdDev)}</TableCell>
                <TableCell align="right">{formatMs(render.rawMean)}</TableCell>
                <TableCell align="right">{entry.iterations}</TableCell>
                <TableCell align="right">{render.outliers}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}

function useBaseSha(repo: string, sha: string | null) {
  const searchParams = useSearchParams();
  const baseParam = searchParams.get('base');
  const prNumberParam = searchParams.get('prNumber');
  const prNumber = prNumberParam ? parseInt(prNumberParam, 10) : undefined;

  const { prInfo, isLoading: isPrLoading } = useGitHubPR(repo, !baseParam ? prNumber : undefined);
  const { compareInfo, isLoading: isCompareLoading } = useCompareCommits(
    repo,
    prInfo?.base.ref,
    sha ?? undefined,
  );

  if (baseParam) {
    return { baseSha: baseParam, isLoading: false };
  }

  if (prNumber) {
    return {
      baseSha: compareInfo?.mergeBase ?? null,
      isLoading: isPrLoading || isCompareLoading,
    };
  }

  return { baseSha: null, isLoading: false };
}

function ComparisonSection({
  repo,
  baseSha,
  headSha,
}: {
  repo: string;
  baseSha: string;
  headSha: string;
}) {
  const {
    data: baseReport,
    isLoading: isBaseLoading,
    error: baseError,
  } = useQuery({
    queryKey: ['benchmark-report', repo, baseSha],
    queryFn: () => fetchBenchmarkReport(repo, baseSha),
    retry: 1,
  });

  const {
    data: headReport,
    isLoading: isHeadLoading,
    error: headError,
  } = useQuery({
    queryKey: ['benchmark-report', repo, headSha],
    queryFn: () => fetchBenchmarkReport(repo, headSha),
    retry: 1,
  });

  const isLoading = isBaseLoading || isHeadLoading;
  const error = baseError || headError;
  const baseNotFound = !isBaseLoading && !baseError && baseReport === null;
  const headNotFound = !isHeadLoading && !headError && headReport === null;
  const diffs = React.useMemo(() => computeDiffs(baseReport, headReport), [baseReport, headReport]);

  return (
    <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
      <Heading level={2}>Benchmark Comparison</Heading>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Comparing{' '}
        <Link
          href={`https://github.com/${repo}/commit/${baseSha}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {baseSha.substring(0, 7)}
        </Link>
        {' \u2192 '}
        <Link
          href={`https://github.com/${repo}/commit/${headSha}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {headSha.substring(0, 7)}
        </Link>
      </Typography>

      {isLoading && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2 }}>
          <CircularProgress size={16} />
          <Typography>Loading benchmark reports...</Typography>
        </Box>
      )}

      {error && <ErrorDisplay title="Error loading benchmark reports" error={error as Error} />}

      {baseNotFound && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No benchmark report found for base commit {baseSha.substring(0, 7)}.
        </Alert>
      )}

      {headNotFound && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No benchmark report found for head commit {headSha.substring(0, 7)}.
        </Alert>
      )}

      {!isLoading && !error && !baseNotFound && !headNotFound && diffs.length === 0 && (
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
                    {diff.baseDuration !== null ? formatMs(diff.baseDuration) : '\u2014'}
                    {diff.baseStdDev !== null && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        component="span"
                        sx={{ ml: 0.5 }}
                      >
                        \u00b1{formatMs(diff.baseStdDev)}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">
                    {diff.headDuration !== null ? formatMs(diff.headDuration) : '\u2014'}
                    {diff.headStdDev !== null && (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        component="span"
                        sx={{ ml: 0.5 }}
                      >
                        \u00b1{formatMs(diff.headStdDev)}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ color: diffColor(diff) }}>
                    {diff.absoluteDiff !== 0 ? formatDiffMs(diff.absoluteDiff) : '\u2014'}
                    {diff.withinNoise && diff.absoluteDiff !== 0 && <NoiseChip>noise</NoiseChip>}
                  </TableCell>
                  <TableCell align="right" sx={{ color: diffColor(diff) }}>
                    {diff.relativeDiff !== null
                      ? percentFormatter.format(diff.relativeDiff)
                      : '\u2014'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Paper>
  );
}

export default function BenchmarkDetails() {
  const params = useParams<{ owner: string; repo: string }>();
  const searchParams = useSearchParams();

  if (!params.owner || !params.repo) {
    throw new Error('Missing required path parameters');
  }

  const repo = `${params.owner}/${params.repo}`;
  const sha = searchParams.get('sha');
  const prNumber = searchParams.get('prNumber');

  const { baseSha, isLoading: isBaseResolving } = useBaseSha(repo, sha);

  const {
    data: report,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['benchmark-report', repo, sha],
    queryFn: () => fetchBenchmarkReport(repo, sha!),
    retry: 1,
    enabled: Boolean(sha),
  });

  const reportNotFound = !isLoading && !error && report === null && Boolean(sha);

  const globalMaxDuration = React.useMemo(() => {
    if (!report) {
      return 0;
    }
    let max = 0;
    for (const entry of Object.values(report)) {
      for (const render of entry.renders) {
        if (render.actualDuration > max) {
          max = render.actualDuration;
        }
      }
    }
    return max;
  }, [report]);

  if (!sha) {
    return (
      <React.Fragment>
        <Heading level={1}>Benchmark Details</Heading>
        <Paper elevation={2} sx={{ p: 3 }}>
          <Typography color="error">Missing required &quot;sha&quot; query parameter.</Typography>
        </Paper>
      </React.Fragment>
    );
  }

  return (
    <React.Fragment>
      <Heading level={1}>Benchmark Details</Heading>

      {prNumber && (
        <Box sx={{ mb: 2 }}>
          <Button
            component={NextLink}
            href={`/repository/${params.owner}/${params.repo}/prs/${prNumber}`}
            startIcon={<ArrowBackIcon />}
            size="small"
          >
            Back to PR #{prNumber}
          </Button>
        </Box>
      )}

      {isBaseResolving && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2 }}>
          <CircularProgress size={16} />
          <Typography>Resolving baseline commit...</Typography>
        </Box>
      )}

      {!isBaseResolving && baseSha && (
        <ComparisonSection repo={repo} baseSha={baseSha} headSha={sha} />
      )}

      {!isBaseResolving && !baseSha && (
        <Alert severity="info" sx={{ mb: 3 }}>
          No baseline commit found — showing details only.
        </Alert>
      )}

      <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Commit{' '}
          <Link
            href={`https://github.com/${repo}/commit/${sha}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {sha.substring(0, 7)}
          </Link>
        </Typography>

        {isLoading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2 }}>
            <CircularProgress size={16} />
            <Typography>Loading benchmark report...</Typography>
          </Box>
        )}

        {error && <ErrorDisplay title="Error loading benchmark report" error={error as Error} />}

        {reportNotFound && (
          <Alert severity="info">No benchmark report found for this commit.</Alert>
        )}

        {report && (
          <React.Fragment>
            {Object.entries(report).map(([name, entry]: [string, BenchmarkReportEntry]) => (
              <BenchmarkEntryDetail
                key={name}
                name={name}
                entry={entry}
                globalMaxDuration={globalMaxDuration}
              />
            ))}
          </React.Fragment>
        )}
      </Paper>
    </React.Fragment>
  );
}
