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
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { styled } from '@mui/material/styles';
import Tooltip from '@mui/material/Tooltip';
import { BarChart } from '@mui/x-charts-pro/BarChart';
import Heading from '../components/Heading';
import ErrorDisplay from '../components/ErrorDisplay';
import {
  fetchBenchmarkReport,
  type BenchmarkReport,
  type BenchmarkReportEntry,
  type RenderStats,
  type MetricStats,
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

interface RenderDiff {
  baseDuration: number;
  baseStdDev: number;
  absoluteDiff: number;
  relativeDiff: number;
  withinNoise: boolean;
}

interface MetricDiff {
  baseMean: number;
  baseStdDev: number;
  absoluteDiff: number;
  relativeDiff: number;
  withinNoise: boolean;
}

function computeRenderDiff(
  render: RenderStats,
  baseEntry: BenchmarkReportEntry | undefined,
): RenderDiff | null {
  if (!baseEntry) {
    return null;
  }
  const baseRender = baseEntry.renders.find((r) => r.id === render.id && r.phase === render.phase);
  if (!baseRender) {
    return null;
  }
  const absoluteDiff = render.actualDuration - baseRender.actualDuration;
  const relativeDiff =
    baseRender.actualDuration !== 0 ? absoluteDiff / baseRender.actualDuration : 0;
  const combinedStdDev = baseRender.stdDev + render.stdDev;
  return {
    baseDuration: baseRender.actualDuration,
    baseStdDev: baseRender.stdDev,
    absoluteDiff,
    relativeDiff,
    withinNoise: Math.abs(absoluteDiff) <= combinedStdDev,
  };
}

function computeMetricDiff(
  metricName: string,
  stats: MetricStats,
  baseEntry: BenchmarkReportEntry | undefined,
): MetricDiff | null {
  if (!baseEntry) {
    return null;
  }
  const baseStats = baseEntry.metrics[metricName];
  if (!baseStats) {
    return null;
  }
  const absoluteDiff = stats.mean - baseStats.mean;
  const relativeDiff = baseStats.mean !== 0 ? absoluteDiff / baseStats.mean : 0;
  const combinedStdDev = baseStats.stdDev + stats.stdDev;
  return {
    baseMean: baseStats.mean,
    baseStdDev: baseStats.stdDev,
    absoluteDiff,
    relativeDiff,
    withinNoise: Math.abs(absoluteDiff) <= combinedStdDev,
  };
}

function diffValueColor(absoluteDiff: number, withinNoise: boolean): string {
  if (withinNoise || absoluteDiff === 0) {
    return 'text.secondary';
  }
  return absoluteDiff > 0 ? 'error.main' : 'success.main';
}

function computeEntryTotalDiff(
  entry: BenchmarkReportEntry,
  baseEntry: BenchmarkReportEntry | undefined,
): { absoluteDiff: number; relativeDiff: number } | null {
  if (!baseEntry) {
    return null;
  }
  const absoluteDiff = entry.totalDuration - baseEntry.totalDuration;
  const relativeDiff = baseEntry.totalDuration !== 0 ? absoluteDiff / baseEntry.totalDuration : 0;
  return { absoluteDiff, relativeDiff };
}

function computeEntryRenderCountDiff(
  entry: BenchmarkReportEntry,
  baseEntry: BenchmarkReportEntry | undefined,
): number | null {
  if (!baseEntry) {
    return null;
  }
  return entry.renders.length - baseEntry.renders.length;
}

const NoiseChip = styled('span')(({ theme }) => ({
  fontSize: '0.7rem',
  padding: '1px 4px',
  borderRadius: 4,
  backgroundColor: theme.vars.palette.action.hover,
  color: theme.vars.palette.text.secondary,
  marginLeft: theme.spacing(0.5),
}));

const ToggleSelectButton = styled(Button)(({ theme }) => ({
  minWidth: 'auto',
  padding: 0,
  fontSize: '0.75rem',
  textTransform: 'none',
  textDecoration: 'underline',
  color: theme.vars.palette.primary.main,
  '&:hover': {
    textDecoration: 'underline',
    backgroundColor: 'transparent',
  },
  '&.Mui-disabled': {
    color: theme.vars.palette.text.primary,
    textDecoration: 'none',
  },
}));

type ViewMode = 'chart' | 'details';

const PHASE_COLORS: Record<string, string> = {
  mount: '#1976d2',
  update: '#2e7d32',
  'nested-update': '#ed6c02',
};

const BAR_WIDTH = 20;
const BAR_GAP = 2;
const CHART_HEIGHT = 32;

function RenderBarChart({
  entry,
  globalMaxDuration,
}: {
  entry: BenchmarkReportEntry;
  globalMaxDuration: number;
}) {
  return (
    <Box sx={{ overflowX: 'auto' }}>
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
            globalMaxDuration > 0 ? (render.actualDuration / globalMaxDuration) * CHART_HEIGHT : 0;
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

function RegressionChart({
  entries,
  baseReport,
}: {
  entries: Array<[string, BenchmarkReportEntry]>;
  baseReport: BenchmarkReport;
}) {
  const names: string[] = [];
  const diffs: number[] = [];

  for (const [name, entry] of entries) {
    const base = baseReport[name];
    if (!base || base.totalDuration === 0) {
      continue;
    }
    const relativeDiff = (entry.totalDuration - base.totalDuration) / base.totalDuration;
    names.push(name);
    diffs.push(relativeDiff);
  }

  if (names.length === 0) {
    return null;
  }

  return (
    <Box sx={{ mb: 2 }}>
      <BarChart
        layout="horizontal"
        yAxis={[{ scaleType: 'band', data: names, width: 240 }]}
        xAxis={[
          {
            colorMap: {
              type: 'piecewise',
              thresholds: [0],
              colors: ['#2e7d32', '#d32f2f'],
            },
            valueFormatter: (v: number) => percentFormatter.format(v),
          },
        ]}
        series={[
          {
            data: diffs,
            valueFormatter: (v) => (v !== null ? percentFormatter.format(v) : ''),
          },
        ]}
        height={names.length * 40 + 40}
        hideLegend
        grid={{ vertical: true }}
      />
    </Box>
  );
}

function DiffCell({
  absoluteDiff,
  relativeDiff,
  withinNoise,
}: {
  absoluteDiff: number;
  relativeDiff: number;
  withinNoise: boolean;
}) {
  const color = diffValueColor(absoluteDiff, withinNoise);
  return (
    <React.Fragment>
      <TableCell align="right" sx={{ color }}>
        {absoluteDiff !== 0 ? formatDiffMs(absoluteDiff) : '\u2014'}
        {withinNoise && absoluteDiff !== 0 && <NoiseChip>noise</NoiseChip>}
      </TableCell>
      <TableCell align="right" sx={{ color }}>
        {percentFormatter.format(relativeDiff)}
      </TableCell>
    </React.Fragment>
  );
}

function BenchmarkAccordion({
  name,
  entry,
  baseEntry,
  globalMaxDuration,
}: {
  name: string;
  entry: BenchmarkReportEntry;
  baseEntry: BenchmarkReportEntry | undefined;
  globalMaxDuration: number;
}) {
  const totalDiff = computeEntryTotalDiff(entry, baseEntry);
  const renderCountDiff = computeEntryRenderCountDiff(entry, baseEntry);
  const hasBase = baseEntry !== undefined;

  let summaryColor: string | undefined;
  if (totalDiff && totalDiff.absoluteDiff !== 0) {
    summaryColor = totalDiff.absoluteDiff > 0 ? 'error.main' : 'success.main';
  }

  return (
    <Accordion defaultExpanded={false} disableGutters>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%', mr: 1 }}>
          <Typography variant="subtitle1" fontWeight={600} sx={{ flexShrink: 0 }}>
            {name}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, ml: 'auto', flexShrink: 0 }}>
            <Typography variant="body2" color="text.secondary">
              {formatMs(entry.totalDuration)}
              {totalDiff && totalDiff.absoluteDiff !== 0 && (
                <Typography component="span" variant="body2" sx={{ color: summaryColor, ml: 0.5 }}>
                  ({formatDiffMs(totalDiff.absoluteDiff)})
                </Typography>
              )}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {entry.renders.length} renders
              {renderCountDiff !== null && (
                <Typography
                  component="span"
                  variant="body2"
                  sx={{
                    color: renderCountDiff > 0 ? 'error.main' : 'success.main',
                    ml: 0.5,
                  }}
                >
                  ({renderCountDiff > 0 ? '+' : ''}
                  {renderCountDiff})
                </Typography>
              )}
            </Typography>
          </Box>
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <RenderBarChart entry={entry} globalMaxDuration={globalMaxDuration} />

        <Typography variant="body2" color="text.secondary" sx={{ mb: 1, mt: 1 }}>
          {entry.iterations} iterations
        </Typography>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Phase</TableCell>
                <TableCell align="right">Duration</TableCell>
                <TableCell align="right">Std Dev</TableCell>
                <TableCell align="right">Outliers</TableCell>
                {hasBase && <TableCell align="right">Base</TableCell>}
                {hasBase && <TableCell align="right">Diff</TableCell>}
                {hasBase && <TableCell align="right">Change</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {entry.renders.map((render: RenderStats) => {
                const diff = computeRenderDiff(render, baseEntry);
                return (
                  <TableRow key={`${render.id}-${render.phase}`}>
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
                      {render.id} / {render.phase}
                    </TableCell>
                    <TableCell align="right">{formatMs(render.actualDuration)}</TableCell>
                    <TableCell align="right">{formatMs(render.stdDev)}</TableCell>
                    <TableCell align="right">{render.outliers}</TableCell>
                    {hasBase && (
                      <TableCell align="right">
                        {diff ? formatMs(diff.baseDuration) : '\u2014'}
                      </TableCell>
                    )}
                    {(() => {
                      if (!hasBase) {
                        return null;
                      }
                      if (diff) {
                        return (
                          <DiffCell
                            absoluteDiff={diff.absoluteDiff}
                            relativeDiff={diff.relativeDiff}
                            withinNoise={diff.withinNoise}
                          />
                        );
                      }
                      return (
                        <React.Fragment>
                          <TableCell align="right">{'\u2014'}</TableCell>
                          <TableCell align="right">{'\u2014'}</TableCell>
                        </React.Fragment>
                      );
                    })()}
                  </TableRow>
                );
              })}
              {baseEntry &&
                baseEntry.renders
                  .filter(
                    (baseRender) =>
                      !entry.renders.some(
                        (r) => r.id === baseRender.id && r.phase === baseRender.phase,
                      ),
                  )
                  .map((baseRender) => (
                    <TableRow key={`base-${baseRender.id}-${baseRender.phase}`}>
                      <TableCell sx={{ color: 'text.secondary' }}>
                        <Box
                          component="span"
                          sx={{
                            display: 'inline-block',
                            width: 10,
                            height: 10,
                            borderRadius: '2px',
                            backgroundColor: PHASE_COLORS[baseRender.phase] ?? '#9c27b0',
                            mr: 0.75,
                            verticalAlign: 'middle',
                            opacity: 0.5,
                          }}
                        />
                        {baseRender.id} / {baseRender.phase} (removed)
                      </TableCell>
                      <TableCell align="right">{'\u2014'}</TableCell>
                      <TableCell align="right">{'\u2014'}</TableCell>
                      <TableCell align="right">{'\u2014'}</TableCell>
                      <TableCell align="right">{formatMs(baseRender.actualDuration)}</TableCell>
                      <TableCell align="right" sx={{ color: 'success.main' }}>
                        {formatDiffMs(-baseRender.actualDuration)}
                      </TableCell>
                      <TableCell align="right" sx={{ color: 'success.main' }}>
                        {percentFormatter.format(-1)}
                      </TableCell>
                    </TableRow>
                  ))}
            </TableBody>
          </Table>
        </TableContainer>

        {(Object.keys(entry.metrics).length > 0 ||
          (baseEntry && Object.keys(baseEntry.metrics).length > 0)) && (
          <React.Fragment>
            <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
              Metrics
            </Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell align="right">Mean</TableCell>
                    <TableCell align="right">Std Dev</TableCell>
                    <TableCell align="right">Outliers</TableCell>
                    {hasBase && <TableCell align="right">Base</TableCell>}
                    {hasBase && <TableCell align="right">Diff</TableCell>}
                    {hasBase && <TableCell align="right">Change</TableCell>}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Object.entries(entry.metrics).map(([metricName, stats]) => {
                    const diff = computeMetricDiff(metricName, stats, baseEntry);
                    return (
                      <TableRow key={metricName}>
                        <TableCell>{metricName}</TableCell>
                        <TableCell align="right">{formatMs(stats.mean)}</TableCell>
                        <TableCell align="right">{formatMs(stats.stdDev)}</TableCell>
                        <TableCell align="right">{stats.outliers}</TableCell>
                        {hasBase && (
                          <TableCell align="right">
                            {diff ? formatMs(diff.baseMean) : '\u2014'}
                          </TableCell>
                        )}
                        {(() => {
                          if (!hasBase) {
                            return null;
                          }
                          if (diff) {
                            return (
                              <DiffCell
                                absoluteDiff={diff.absoluteDiff}
                                relativeDiff={diff.relativeDiff}
                                withinNoise={diff.withinNoise}
                              />
                            );
                          }
                          return (
                            <React.Fragment>
                              <TableCell align="right">{'\u2014'}</TableCell>
                              <TableCell align="right">{'\u2014'}</TableCell>
                            </React.Fragment>
                          );
                        })()}
                      </TableRow>
                    );
                  })}
                  {baseEntry &&
                    Object.entries(baseEntry.metrics)
                      .filter(([metricName]) => !(metricName in entry.metrics))
                      .map(([metricName, baseStats]) => (
                        <TableRow key={`base-${metricName}`}>
                          <TableCell sx={{ color: 'text.secondary' }}>
                            {metricName} (removed)
                          </TableCell>
                          <TableCell align="right">{'\u2014'}</TableCell>
                          <TableCell align="right">{'\u2014'}</TableCell>
                          <TableCell align="right">{'\u2014'}</TableCell>
                          <TableCell align="right">{formatMs(baseStats.mean)}</TableCell>
                          <TableCell align="right" sx={{ color: 'success.main' }}>
                            {formatDiffMs(-baseStats.mean)}
                          </TableCell>
                          <TableCell align="right" sx={{ color: 'success.main' }}>
                            {percentFormatter.format(-1)}
                          </TableCell>
                        </TableRow>
                      ))}
                </TableBody>
              </Table>
            </TableContainer>
          </React.Fragment>
        )}
      </AccordionDetails>
    </Accordion>
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

function sortEntriesByRegression(
  entries: Array<[string, BenchmarkReportEntry]>,
  baseReport: BenchmarkReport | null | undefined,
): Array<[string, BenchmarkReportEntry]> {
  if (!baseReport) {
    return entries;
  }
  return [...entries].sort((a, b) => {
    const aBase = baseReport[a[0]];
    const bBase = baseReport[b[0]];
    const aRelDiff =
      aBase && aBase.totalDuration !== 0
        ? (a[1].totalDuration - aBase.totalDuration) / aBase.totalDuration
        : 0;
    const bRelDiff =
      bBase && bBase.totalDuration !== 0
        ? (b[1].totalDuration - bBase.totalDuration) / bBase.totalDuration
        : 0;
    // Worst regression (highest positive diff) first
    return bRelDiff - aRelDiff;
  });
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

  const {
    data: baseReport,
    isLoading: isBaseLoading,
    error: baseError,
  } = useQuery({
    queryKey: ['benchmark-report', repo, baseSha],
    queryFn: () => fetchBenchmarkReport(repo, baseSha!),
    retry: 1,
    enabled: Boolean(baseSha),
  });

  const [viewMode, setViewMode] = React.useState<ViewMode>('details');

  const reportNotFound = !isLoading && !error && report === null && Boolean(sha);
  const baseNotFound = !isBaseLoading && !baseError && baseReport === null && Boolean(baseSha);

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

  const sortedEntries = React.useMemo(() => {
    if (!report) {
      return [];
    }
    return sortEntriesByRegression(Object.entries(report), baseReport);
  }, [report, baseReport]);

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

      <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Typography variant="body2" color="text.secondary">
            Commit{' '}
            <Link
              href={`https://github.com/${repo}/commit/${sha}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {sha.substring(0, 7)}
            </Link>
            {baseSha && !baseNotFound && (
              <React.Fragment>
                {' \u2192 comparing against '}
                <Link
                  href={`https://github.com/${repo}/commit/${baseSha}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {baseSha.substring(0, 7)}
                </Link>
              </React.Fragment>
            )}
            {baseSha && baseNotFound && (
              <React.Fragment>
                {' \u2014 no base report for '}
                <Link
                  href={`https://github.com/${repo}/commit/${baseSha}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {baseSha.substring(0, 7)}
                </Link>
              </React.Fragment>
            )}
            {!isBaseResolving && !baseSha && ' \u2014 no baseline'}
          </Typography>
          {report && baseReport && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                ml: 'auto',
                flexShrink: 0,
              }}
            >
              <Typography variant="caption" color="text.secondary">
                View:
              </Typography>
              <ToggleSelectButton
                variant="text"
                size="small"
                onClick={() => setViewMode('details')}
                disabled={viewMode === 'details'}
              >
                details
              </ToggleSelectButton>
              <Typography variant="caption" color="text.secondary">
                |
              </Typography>
              <ToggleSelectButton
                variant="text"
                size="small"
                onClick={() => setViewMode('chart')}
                disabled={viewMode === 'chart'}
              >
                chart
              </ToggleSelectButton>
            </Box>
          )}
        </Box>

        {isBaseResolving && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1 }}>
            <CircularProgress size={16} />
            <Typography variant="body2">Resolving baseline commit...</Typography>
          </Box>
        )}

        {(isLoading || isBaseLoading) && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 2 }}>
            <CircularProgress size={16} />
            <Typography>Loading benchmark reports...</Typography>
          </Box>
        )}

        {error && <ErrorDisplay title="Error loading benchmark report" error={error as Error} />}
        {baseError && (
          <ErrorDisplay title="Error loading base benchmark report" error={baseError as Error} />
        )}

        {reportNotFound && (
          <Alert severity="info" sx={{ mb: 2 }}>
            No benchmark report found for this commit.
          </Alert>
        )}

        {report && baseReport && viewMode === 'chart' && (
          <RegressionChart entries={sortedEntries} baseReport={baseReport} />
        )}

        {report &&
          (!baseReport || viewMode === 'details') &&
          sortedEntries.map(([name, entry]) => (
            <BenchmarkAccordion
              key={name}
              name={name}
              entry={entry}
              baseEntry={baseReport?.[name]}
              globalMaxDuration={globalMaxDuration}
            />
          ))}
      </Paper>
    </React.Fragment>
  );
}
