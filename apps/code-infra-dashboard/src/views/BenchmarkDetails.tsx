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
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
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
import CopyButton from '../components/CopyButton';
import {
  fetchBenchmarkReport,
  type BenchmarkReportEntry,
  type RenderStats,
} from '../utils/fetchBenchmarkReport';
import { useGitHubPR } from '../hooks/useGitHubPR';
import { useCompareCommits } from '../hooks/useCompareCommits';
import { formatMs, formatDiffMs, percentFormatter } from '../utils/formatters';
import {
  compareBenchmarkReports,
  type BenchmarkComparisonReport,
  type ComparisonItem,
  type DiffValue,
  type BenchmarkDiffSeverity,
} from '../utils/compareBenchmarkReports';
import { buildBenchmarkMarkdownReport } from '../utils/buildBenchmarkMarkdownReport';

const SEVERITY_COLOR: Record<BenchmarkDiffSeverity, string> = {
  error: 'error.main',
  success: 'success.main',
  neutral: 'text.secondary',
};

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
        {entry.renders.map((render, index) => {
          const height =
            globalMaxDuration > 0 ? (render.actualDuration / globalMaxDuration) * CHART_HEIGHT : 0;
          return (
            <Tooltip
              key={`${render.id}-${render.phase}-${index}`}
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

function RegressionChart({ entries }: { entries: ComparisonItem[] }) {
  const names: string[] = [];
  const diffs: number[] = [];

  for (const entry of entries) {
    if (entry.duration.base === null || entry.duration.base === 0) {
      continue;
    }
    names.push(entry.name);
    diffs.push(entry.duration.relativeDiff);
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

function FormattedDiffMs({ diff, percent = false }: { diff: DiffValue; percent?: boolean }) {
  if (diff.absoluteDiff === 0) {
    return '\u2014';
  }
  return (
    <React.Fragment>
      {formatDiffMs(diff.absoluteDiff)}
      {percent && (
        <React.Fragment>
          {' '}
          <Typography component="span" variant="caption">
            {percentFormatter.format(diff.relativeDiff)}
          </Typography>
        </React.Fragment>
      )}
    </React.Fragment>
  );
}

function DiffCell({ diff }: { diff: DiffValue }) {
  const color = SEVERITY_COLOR[diff.severity];
  return (
    <Tooltip title={diff.hint} arrow>
      <TableCell align="right" sx={{ color }}>
        <FormattedDiffMs diff={diff} percent />
      </TableCell>
    </Tooltip>
  );
}

function TotalsSummary({ totals }: { totals: BenchmarkComparisonReport['totals'] }) {
  return (
    <Box
      sx={{
        display: 'flex',
        gap: 3,
      }}
    >
      <Tooltip title={totals.duration.hint} arrow>
        <Typography variant="body2">
          <strong>Total duration:</strong>{' '}
          <Typography
            component="span"
            variant="body2"
            sx={{ color: SEVERITY_COLOR[totals.duration.severity] }}
          >
            <FormattedDiffMs diff={totals.duration} percent />
          </Typography>
        </Typography>
      </Tooltip>
      <Tooltip title={totals.renderCount.hint} arrow>
        <Typography variant="body2">
          <strong>Renders:</strong>{' '}
          <Typography
            component="span"
            variant="body2"
            sx={{ color: SEVERITY_COLOR[totals.renderCount.severity] }}
          >
            {totals.renderCount.absoluteDiff >= 0 ? '+' : ''}
            {totals.renderCount.absoluteDiff}
          </Typography>
        </Typography>
      </Tooltip>
      {totals.paintDefault && (
        <Tooltip title={totals.paintDefault.hint} arrow>
          <Typography variant="body2">
            <strong>Paint:</strong>{' '}
            <Typography
              component="span"
              variant="body2"
              sx={{ color: SEVERITY_COLOR[totals.paintDefault.severity] }}
            >
              <FormattedDiffMs diff={totals.paintDefault} percent />
            </Typography>
          </Typography>
        </Tooltip>
      )}
    </Box>
  );
}

function BenchmarkAccordion({
  name,
  entry,
  comparison,
  globalMaxDuration,
}: {
  name: string;
  entry: BenchmarkReportEntry;
  comparison: ComparisonItem | null;
  globalMaxDuration: number;
}) {
  const hasBase = comparison !== null;
  const nameCellSx = {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } as const;

  let summaryColor: string | undefined;
  if (comparison && comparison.duration.absoluteDiff !== 0) {
    summaryColor = comparison.duration.absoluteDiff > 0 ? 'error.main' : 'success.main';
  }

  // Split children into renders and metrics by matching names
  const renderComparisons = new Map<string, ComparisonItem>();
  const metricComparisons = new Map<string, ComparisonItem>();
  if (comparison?.children) {
    for (const child of comparison.children) {
      // Renders have "id:phase" format names
      if (child.name.includes(':')) {
        renderComparisons.set(child.name, child);
      } else {
        metricComparisons.set(child.name, child);
      }
    }
  }

  // Separate current renders from removed renders
  const removedRenders =
    comparison?.children?.filter(
      (child) => child.name.includes(':') && child.duration.current === null,
    ) ?? [];

  const removedMetrics =
    comparison?.children?.filter(
      (child) => !child.name.includes(':') && child.duration.current === null,
    ) ?? [];

  return (
    <Accordion defaultExpanded={false}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%', mr: 1 }}>
          <Typography variant="subtitle1" fontWeight={600} sx={{ flexShrink: 0 }}>
            {name}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, ml: 'auto', flexShrink: 0 }}>
            <Typography variant="body2" color="text.secondary">
              {formatMs(entry.totalDuration)}
              {comparison && (
                <Tooltip title={comparison.duration.hint} arrow>
                  <Typography
                    component="span"
                    variant="body2"
                    sx={{ color: summaryColor, ml: 0.5 }}
                  >
                    <FormattedDiffMs diff={comparison.duration} />
                  </Typography>
                </Tooltip>
              )}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {entry.renders.length} renders
              {comparison?.renderCount && (
                <Tooltip title={comparison.renderCount.hint} arrow>
                  <Typography
                    component="span"
                    variant="body2"
                    sx={{
                      color: SEVERITY_COLOR[comparison.renderCount.severity],
                      ml: 0.5,
                    }}
                  >
                    ({comparison.renderCount.absoluteDiff >= 0 ? '+' : ''}
                    {comparison.renderCount.absoluteDiff})
                  </Typography>
                </Tooltip>
              )}
            </Typography>
          </Box>
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <RenderBarChart entry={entry} globalMaxDuration={globalMaxDuration} />

        <Typography variant="subtitle2" sx={{ mt: 1, mb: 1 }}>
          React Renders
        </Typography>

        <TableContainer>
          <Table size="small" sx={{ tableLayout: 'fixed', minWidth: hasBase ? 580 : 330 }}>
            <TableHead>
              <TableRow>
                <TableCell>Phase</TableCell>
                <TableCell align="right" sx={{ width: 150 }}>
                  Duration
                </TableCell>
                <TableCell align="right" sx={{ width: 80 }}>
                  Outliers
                </TableCell>
                {hasBase && (
                  <TableCell align="right" sx={{ width: 100 }}>
                    Base
                  </TableCell>
                )}
                {hasBase && (
                  <TableCell align="right" sx={{ width: 150 }}>
                    Diff
                  </TableCell>
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {entry.renders.map((render: RenderStats, index: number) => {
                const comp = renderComparisons.get(`${render.id}:${render.phase}`);
                return (
                  <TableRow key={`${render.id}-${render.phase}-${index}`}>
                    <TableCell sx={nameCellSx} title={`${render.id} / ${render.phase}`}>
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
                    <TableCell align="right">
                      {formatMs(render.actualDuration)}{' '}
                      <Typography component="span" variant="caption" color="text.secondary">
                        ±{formatMs(render.stdDev)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">{render.outliers}</TableCell>
                    {hasBase && (
                      <TableCell align="right">
                        {comp?.duration.base != null ? formatMs(comp.duration.base) : '\u2014'}
                      </TableCell>
                    )}
                    {(() => {
                      if (!hasBase) {
                        return null;
                      }
                      if (comp) {
                        return <DiffCell diff={comp.duration} />;
                      }
                      return <TableCell align="right">{'\u2014'}</TableCell>;
                    })()}
                  </TableRow>
                );
              })}
              {removedRenders.map((comp) => {
                const [id, phase] = comp.name.split(':');
                return (
                  <TableRow key={`base-${comp.name}`}>
                    <TableCell
                      sx={{ ...nameCellSx, color: 'text.secondary' }}
                      title={`${id} / ${phase} (removed)`}
                    >
                      <Box
                        component="span"
                        sx={{
                          display: 'inline-block',
                          width: 10,
                          height: 10,
                          borderRadius: '2px',
                          backgroundColor: PHASE_COLORS[phase] ?? '#9c27b0',
                          mr: 0.75,
                          verticalAlign: 'middle',
                          opacity: 0.5,
                        }}
                      />
                      {id} / {phase} (removed)
                    </TableCell>
                    <TableCell align="right">{'\u2014'}</TableCell>
                    <TableCell align="right">{'\u2014'}</TableCell>
                    <TableCell align="right">
                      {comp.duration.base != null ? formatMs(comp.duration.base) : '\u2014'}
                    </TableCell>
                    <TableCell align="right" sx={{ color: 'success.main' }}>
                      <FormattedDiffMs diff={comp.duration} percent />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>

        {(Object.keys(entry.metrics).length > 0 || removedMetrics.length > 0) && (
          <React.Fragment>
            <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
              Metrics
            </Typography>
            <TableContainer>
              <Table size="small" sx={{ tableLayout: 'fixed', minWidth: hasBase ? 580 : 330 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell align="right" sx={{ width: 150 }}>
                      Mean
                    </TableCell>
                    <TableCell align="right" sx={{ width: 80 }}>
                      Outliers
                    </TableCell>
                    {hasBase && (
                      <TableCell align="right" sx={{ width: 100 }}>
                        Base
                      </TableCell>
                    )}
                    {hasBase && (
                      <TableCell align="right" sx={{ width: 150 }}>
                        Diff
                      </TableCell>
                    )}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Object.entries(entry.metrics).map(([metricName, stats]) => {
                    const comp = metricComparisons.get(metricName);
                    return (
                      <TableRow key={metricName}>
                        <TableCell sx={nameCellSx} title={metricName}>
                          {metricName}
                        </TableCell>
                        <TableCell align="right">
                          {formatMs(stats.mean)}{' '}
                          <Typography component="span" variant="caption" color="text.secondary">
                            ±{formatMs(stats.stdDev)}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">{stats.outliers}</TableCell>
                        {hasBase && (
                          <TableCell align="right">
                            {comp?.duration.base != null ? formatMs(comp.duration.base) : '\u2014'}
                          </TableCell>
                        )}
                        {(() => {
                          if (!hasBase) {
                            return null;
                          }
                          if (comp) {
                            return <DiffCell diff={comp.duration} />;
                          }
                          return <TableCell align="right">{'\u2014'}</TableCell>;
                        })()}
                      </TableRow>
                    );
                  })}
                  {removedMetrics.map((comp) => (
                    <TableRow key={`base-${comp.name}`}>
                      <TableCell
                        sx={{ ...nameCellSx, color: 'text.secondary' }}
                        title={`${comp.name} (removed)`}
                      >
                        {comp.name} (removed)
                      </TableCell>
                      <TableCell align="right">{'\u2014'}</TableCell>
                      <TableCell align="right">{'\u2014'}</TableCell>
                      <TableCell align="right">
                        {comp.duration.base != null ? formatMs(comp.duration.base) : '\u2014'}
                      </TableCell>
                      <TableCell align="right" sx={{ color: 'success.main' }}>
                        <FormattedDiffMs diff={comp.duration} percent />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </React.Fragment>
        )}

        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {entry.iterations} iterations
        </Typography>
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

function MarkdownReportDialog({
  comparisonReport,
}: {
  comparisonReport: BenchmarkComparisonReport;
}) {
  const reportText = buildBenchmarkMarkdownReport(comparisonReport, {
    reportUrl: window.location.href,
  });
  const [open, setOpen] = React.useState(false);

  return (
    <React.Fragment>
      <Button variant="outlined" size="small" onClick={() => setOpen(true)}>
        Markdown Report
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Markdown Report</DialogTitle>
        <DialogContent>
          <Box sx={{ position: 'relative' }}>
            <CopyButton text={reportText} sx={{ position: 'absolute', right: 8, top: 8 }} />
            <Box
              component="pre"
              sx={{
                whiteSpace: 'pre',
                fontFamily: 'monospace',
                fontSize: '0.8rem',
                overflow: 'auto',
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                p: 2,
                m: 0,
              }}
            >
              {reportText}
            </Box>
          </Box>
        </DialogContent>
      </Dialog>
    </React.Fragment>
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

  const comparisonReport = React.useMemo(
    () => (report && baseReport ? compareBenchmarkReports(report, baseReport) : null),
    [report, baseReport],
  );

  // Build a name→ComparisonItem lookup for the accordion
  const comparisonByName = React.useMemo(() => {
    if (!comparisonReport) {
      return null;
    }
    const map = new Map<string, ComparisonItem>();
    for (const entry of comparisonReport.entries) {
      map.set(entry.name, entry);
    }
    return map;
  }, [comparisonReport]);

  // Use comparison order when available (sorted by regression), otherwise raw report order
  const sortedEntryNames = React.useMemo(() => {
    if (comparisonReport) {
      return comparisonReport.entries.map((entry) => entry.name);
    }
    if (report) {
      return Object.keys(report);
    }
    return [];
  }, [comparisonReport, report]);

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

      <Paper elevation={2} sx={{ p: 3, mb: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
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
              {comparisonReport && <MarkdownReportDialog comparisonReport={comparisonReport} />}
              <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
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
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <CircularProgress size={16} />
            <Typography variant="body2">Resolving baseline commit...</Typography>
          </Box>
        )}

        {(isLoading || isBaseLoading) && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <CircularProgress size={16} />
            <Typography>Loading benchmark reports...</Typography>
          </Box>
        )}

        {error && <ErrorDisplay title="Error loading benchmark report" error={error as Error} />}
        {baseError && (
          <ErrorDisplay title="Error loading base benchmark report" error={baseError as Error} />
        )}

        {reportNotFound && (
          <Alert severity="info">No benchmark report found for this commit.</Alert>
        )}

        {comparisonReport && <TotalsSummary totals={comparisonReport.totals} />}

        {report && comparisonReport && viewMode === 'chart' && (
          <RegressionChart entries={comparisonReport.entries} />
        )}

        {report && (!comparisonReport || viewMode === 'details') && (
          <Box>
            {sortedEntryNames.map((name) => {
              const entry = report[name];
              if (!entry) {
                return null;
              }
              return (
                <BenchmarkAccordion
                  key={name}
                  name={name}
                  entry={entry}
                  comparison={comparisonByName?.get(name) ?? null}
                  globalMaxDuration={globalMaxDuration}
                />
              );
            })}
          </Box>
        )}
      </Paper>
    </React.Fragment>
  );
}
