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
import { fetchBenchmarkReport } from '../utils/fetchBenchmarkReport';
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

function DiffCell({ diff, sx }: { diff: DiffValue; sx?: object }) {
  const color = SEVERITY_COLOR[diff.severity];
  return (
    <Tooltip title={diff.hint} arrow>
      <TableCell align="right" sx={{ color, ...sx }}>
        <FormattedDiffMs diff={diff} percent />
      </TableCell>
    </Tooltip>
  );
}

interface ComparisonTableRow {
  key: string;
  name: React.ReactNode;
  title: string;
  value: React.ReactNode;
  outliers: React.ReactNode;
  comparison?: DiffValue | null;
  base?: number | null;
  removed?: boolean;
  valueFill?: number;
  valueColor?: string;
  diffFill?: number;
  diffColor?: string;
}

const NAME_CELL_SX = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;

function ComparisonTable({
  nameHeader,
  valueHeader,
  rows,
  hasBase,
}: {
  nameHeader: string;
  valueHeader: string;
  rows: ComparisonTableRow[];
  hasBase: boolean;
}) {
  return (
    <TableContainer>
      <Table size="small" sx={{ tableLayout: 'fixed', minWidth: hasBase ? 610 : 360 }}>
        <TableHead>
          <TableRow>
            <TableCell>{nameHeader}</TableCell>
            <TableCell align="right" sx={{ width: 180 }}>
              {valueHeader}
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
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell
                sx={row.removed ? { ...NAME_CELL_SX, color: 'text.secondary' } : NAME_CELL_SX}
                title={row.title}
              >
                {row.name}
              </TableCell>
              <TableCell
                align="right"
                sx={
                  row.valueFill != null && row.valueColor
                    ? {
                        background: `linear-gradient(to left, color-mix(in srgb, ${row.valueColor} 12%, transparent) ${Math.max(row.valueFill * 100, 5)}%, transparent ${Math.max(row.valueFill * 100, 5)}%)`,
                      }
                    : undefined
                }
              >
                {row.value}
              </TableCell>
              <TableCell align="right">{row.outliers}</TableCell>
              {hasBase && (
                <TableCell align="right">
                  {row.base != null ? formatMs(row.base) : '\u2014'}
                </TableCell>
              )}
              {(() => {
                if (!hasBase) {
                  return null;
                }
                if (row.comparison) {
                  const diffBarSx =
                    row.diffFill != null && row.diffColor
                      ? {
                          background: `linear-gradient(to left, color-mix(in srgb, ${row.diffColor} 12%, transparent) ${Math.max(row.diffFill * 100, 5)}%, transparent ${Math.max(row.diffFill * 100, 5)}%)`,
                        }
                      : undefined;
                  return row.removed ? (
                    <TableCell align="right" sx={{ color: 'success.main', ...diffBarSx }}>
                      <FormattedDiffMs diff={row.comparison} percent />
                    </TableCell>
                  ) : (
                    <DiffCell diff={row.comparison} sx={diffBarSx} />
                  );
                }
                return <TableCell align="right">{'\u2014'}</TableCell>;
              })()}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
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
  comparison,
  hasBase,
  globalMaxDuration,
  globalMaxAbsDiff,
}: {
  comparison: ComparisonItem;
  hasBase: boolean;
  globalMaxDuration: number;
  globalMaxAbsDiff: number;
}) {
  const renderCount = comparison.renders.filter((r) => !r.removed).length;

  let summaryColor: string | undefined;
  if (hasBase && comparison.duration.absoluteDiff !== 0) {
    summaryColor = comparison.duration.absoluteDiff > 0 ? 'error.main' : 'success.main';
  }

  return (
    <Accordion
      defaultExpanded={false}
      sx={{ '&.Mui-expanded + .MuiAccordion-root::before': { display: 'none' } }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%', mr: 1 }}>
          <Typography variant="subtitle1" fontWeight={600} sx={{ flexShrink: 0 }}>
            {comparison.name}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, ml: 'auto', flexShrink: 0 }}>
            <Typography variant="body2" color="text.secondary">
              {comparison.duration.current != null
                ? formatMs(comparison.duration.current)
                : '\u2014'}
              {hasBase && (
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
              {renderCount} renders
              {hasBase && comparison.renderCount && (
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
        <Typography variant="subtitle2" sx={{ mt: 1, mb: 1 }}>
          React Renders
        </Typography>

        <ComparisonTable
          nameHeader="Phase"
          valueHeader="Duration"
          hasBase={hasBase}
          rows={comparison.renders.map((row, index) => {
            const label = row.removed ? `${row.name} (removed)` : row.name;
            const DIFF_COLORS: Record<string, string> = {
              error: 'var(--mui-palette-error-main)',
              success: 'var(--mui-palette-success-main)',
            };
            const diffColor = DIFF_COLORS[row.diff.severity] ?? 'var(--mui-palette-action-disabled)';
            return {
              key: `${row.name}-${index}`,
              title: label,
              name: label,
              value: row.removed ? (
                '\u2014'
              ) : (
                <React.Fragment>
                  {formatMs(row.value)}{' '}
                  <Typography component="span" variant="caption" color="text.secondary">
                    ±{formatMs(row.stdDev)}
                  </Typography>
                </React.Fragment>
              ),
              outliers: row.removed ? '\u2014' : row.outliers,
              comparison: row.diff,
              base: row.diff?.base,
              removed: row.removed,
              valueFill: row.removed || globalMaxDuration === 0 ? undefined : row.value / globalMaxDuration,
              valueColor: 'var(--mui-palette-action-disabled)',
              diffFill: hasBase && globalMaxAbsDiff > 0 ? Math.abs(row.diff.absoluteDiff) / globalMaxAbsDiff : undefined,
              diffColor,
            };
          })}
        />

        {comparison.metrics.length > 0 && (
          <React.Fragment>
            <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
              Metrics
            </Typography>
            <ComparisonTable
              nameHeader="Name"
              valueHeader="Mean"
              hasBase={hasBase}
              rows={comparison.metrics.map((row) => {
                const label = row.removed ? `${row.name} (removed)` : row.name;
                return {
                  key: row.name,
                  title: label,
                  name: label,
                  value: row.removed ? (
                    '\u2014'
                  ) : (
                    <React.Fragment>
                      {formatMs(row.value)}{' '}
                      <Typography component="span" variant="caption" color="text.secondary">
                        ±{formatMs(row.stdDev)}
                      </Typography>
                    </React.Fragment>
                  ),
                  outliers: row.removed ? '\u2014' : row.outliers,
                  comparison: row.diff,
                  base: row.diff?.base,
                  removed: row.removed,
                };
              })}
            />
          </React.Fragment>
        )}

        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {comparison.iterations} iterations
        </Typography>
      </AccordionDetails>
    </Accordion>
  );
}

function ComparisonReportView({
  comparisonReport,
  viewMode,
}: {
  comparisonReport: BenchmarkComparisonReport;
  viewMode: ViewMode;
}) {

  const globalMaxDuration = React.useMemo(() => {
    let max = 0;
    for (const entry of comparisonReport.entries) {
      for (const render of entry.renders) {
        if (!render.removed && render.value > max) {
          max = render.value;
        }
      }
    }
    return max;
  }, [comparisonReport]);

  const globalMaxAbsDiff = React.useMemo(() => {
    let max = 0;
    for (const entry of comparisonReport.entries) {
      for (const render of entry.renders) {
        const abs = Math.abs(render.diff.absoluteDiff);
        if (abs > max) {
          max = abs;
        }
      }
    }
    return max;
  }, [comparisonReport]);

  return (
    <React.Fragment>
      {comparisonReport.hasBase && <TotalsSummary totals={comparisonReport.totals} />}

      {comparisonReport.hasBase && viewMode === 'chart' && (
        <RegressionChart entries={comparisonReport.entries} />
      )}

      {(!comparisonReport.hasBase || viewMode === 'details') && (
        <Box>
          {comparisonReport.entries.map((item) => (
            <BenchmarkAccordion
              key={item.name}
              comparison={item}
              hasBase={comparisonReport.hasBase}
              globalMaxDuration={globalMaxDuration}
              globalMaxAbsDiff={globalMaxAbsDiff}
            />
          ))}
        </Box>
      )}
    </React.Fragment>
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

  const comparisonReport = React.useMemo(
    () => (report ? compareBenchmarkReports(report, baseReport ?? null) : null),
    [report, baseReport],
  );

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
          {comparisonReport && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                ml: 'auto',
                flexShrink: 0,
              }}
            >
              <MarkdownReportDialog comparisonReport={comparisonReport} />
              {comparisonReport.hasBase && (
                <React.Fragment>
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
                </React.Fragment>
              )}
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

        {comparisonReport && (
          <ComparisonReportView comparisonReport={comparisonReport} viewMode={viewMode} />
        )}
      </Paper>
    </React.Fragment>
  );
}
