'use client';

import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';
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
import Tooltip from '@mui/material/Tooltip';
import Link from '@mui/material/Link';
import { fetchCiReport, type CiReportTypes } from '@/utils/fetchCiReport';
import {
  compareBenchmarkReports,
  type BenchmarkComparisonReport,
  type ComparisonItem,
  type DiffValue,
  type BenchmarkDiffSeverity,
} from '@/lib/benchmark/compareBenchmarkReports';
import Heading from '../components/Heading';
import ReportHeader from '../components/ReportHeader';
import ErrorDisplay from '../components/ErrorDisplay';
import { formatMs, formatDiffMs, percentFormatter } from '../utils/formatters';

function useCiReport<K extends keyof CiReportTypes>(
  repo: string,
  sha: string | null,
  reportName: K,
) {
  const enabled = Boolean(sha);
  const { data, isLoading, error } = useQuery({
    queryKey: [reportName, repo, sha],
    queryFn: () => fetchCiReport(repo, sha!, reportName),
    retry: 1,
    enabled,
  });
  return { data: data ?? null, isLoading: enabled && isLoading, error };
}

const SEVERITY_COLOR: Record<BenchmarkDiffSeverity, string> = {
  error: 'error.main',
  success: 'success.main',
  neutral: 'text.secondary',
};

const MIN_BAR_WIDTH_PX = 4;

const DIFF_BAR_COLORS: Record<BenchmarkDiffSeverity, string> = {
  error: 'var(--mui-palette-error-main)',
  success: 'var(--mui-palette-success-main)',
  neutral: 'var(--mui-palette-action-disabled)',
};

function computeDiffBar(
  diff: DiffValue,
  minDiff: number,
  maxDiff: number,
): { left: number; width: number; color: string } {
  const range = maxDiff - minDiff;
  const zeroPos = range > 0 ? maxDiff / range : 0.5;
  const diffPos = range > 0 ? (maxDiff - diff.absoluteDiff) / range : 0.5;

  const barLeft = Math.min(zeroPos, diffPos);
  const barWidth = Math.abs(diffPos - zeroPos);

  const color = DIFF_BAR_COLORS[diff.severity];

  return {
    left: barLeft * 100,
    width: barWidth * 100,
    color,
  };
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
  diffBar?: { left: number; width: number; color: string };
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
                        background: `linear-gradient(to right, color-mix(in srgb, ${row.valueColor} 12%, transparent) ${Math.max(row.valueFill * 100, 5)}%, transparent ${Math.max(row.valueFill * 100, 5)}%)`,
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
                  const diffBarSx = row.diffBar
                    ? {
                        background: `linear-gradient(to right, transparent ${row.diffBar.left}%, color-mix(in srgb, ${row.diffBar.color} 12%, transparent) ${row.diffBar.left}%, color-mix(in srgb, ${row.diffBar.color} 12%, transparent) max(${row.diffBar.left + row.diffBar.width}%, ${row.diffBar.left}% + ${MIN_BAR_WIDTH_PX}px), transparent max(${row.diffBar.left + row.diffBar.width}%, ${row.diffBar.left}% + ${MIN_BAR_WIDTH_PX}px))`,
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
        mb: 2,
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
  renderDiffRange,
  entryDiffRange,
}: {
  comparison: ComparisonItem;
  hasBase: boolean;
  globalMaxDuration: number;
  renderDiffRange: { min: number; max: number };
  entryDiffRange: { min: number; max: number };
}) {
  const renderCount = comparison.renders.filter((r) => !r.removed).length;

  const entryBar = hasBase
    ? computeDiffBar(comparison.duration, entryDiffRange.min, entryDiffRange.max)
    : null;

  return (
    <Accordion
      defaultExpanded={false}
      sx={{ '&.Mui-expanded + .MuiAccordion-root::before': { display: 'none' } }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon />}
        sx={
          entryBar
            ? {
                position: 'relative',
                '&::after': {
                  content: '""',
                  position: 'absolute',
                  top: 0,
                  left: `${entryBar.left}%`,
                  height: 3,
                  width: `max(${entryBar.width}%, ${MIN_BAR_WIDTH_PX}px)`,
                  backgroundColor: entryBar.color,
                  opacity: 0.3,
                },
              }
            : undefined
        }
      >
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
                    sx={{ color: SEVERITY_COLOR[comparison.duration.severity], ml: 0.5 }}
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
              valueFill:
                row.removed || globalMaxDuration === 0 ? undefined : row.value / globalMaxDuration,
              valueColor: 'var(--mui-palette-action-disabled)',
              diffBar: hasBase
                ? computeDiffBar(row.diff, renderDiffRange.min, renderDiffRange.max)
                : undefined,
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

interface InlinedBaseAlertProps {
  fetchedBaseSha: string;
  inlinedBaseSha: string;
}

function InlinedBaseAlert({ fetchedBaseSha, inlinedBaseSha }: InlinedBaseAlertProps) {
  const searchParams = useSearchParams();
  const inlinedSearch = React.useMemo(() => {
    const inlinedParams = new URLSearchParams(searchParams.toString());
    inlinedParams.delete('base');
    inlinedParams.delete('baseCommit');
    return inlinedParams.toString();
  }, [searchParams]);
  return (
    <Alert severity="info" sx={{ mb: 2 }}>
      Comparing against fetched base ({fetchedBaseSha.slice(0, 7)}). An inlined base (
      {inlinedBaseSha.slice(0, 7)}) measured in the same CI job is available and may be more
      accurate. <Link href={`?${inlinedSearch}`}>Show with inlined base</Link>
    </Alert>
  );
}

function ComparisonReportView({
  comparisonReport,
}: {
  comparisonReport: BenchmarkComparisonReport;
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

  const renderDiffRange = React.useMemo(() => {
    let min = 0;
    let max = 0;
    for (const entry of comparisonReport.entries) {
      for (const render of entry.renders) {
        const d = render.diff.absoluteDiff;
        if (d < min) {
          min = d;
        }
        if (d > max) {
          max = d;
        }
      }
    }
    return { min, max };
  }, [comparisonReport]);

  const entryDiffRange = React.useMemo(() => {
    let min = 0;
    let max = 0;
    for (const entry of comparisonReport.entries) {
      const d = entry.duration.absoluteDiff;
      if (d < min) {
        min = d;
      }
      if (d > max) {
        max = d;
      }
    }
    return { min, max };
  }, [comparisonReport]);

  return (
    <React.Fragment>
      {comparisonReport.hasBase && <TotalsSummary totals={comparisonReport.totals} />}

      <Box>
        {comparisonReport.entries.map((item) => (
          <BenchmarkAccordion
            key={item.name}
            comparison={item}
            hasBase={comparisonReport.hasBase}
            globalMaxDuration={globalMaxDuration}
            renderDiffRange={renderDiffRange}
            entryDiffRange={entryDiffRange}
          />
        ))}
      </Box>
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
  const baseSha = searchParams.get('base') ?? searchParams.get('baseCommit');

  const { data: report, isLoading, error } = useCiReport(repo, sha, 'benchmark.json');
  const {
    data: baseReport,
    isLoading: isBaseLoading,
    error: baseError,
  } = useCiReport(repo, baseSha, 'benchmark.json');

  const reportNotFound = !isLoading && !error && report === null && Boolean(sha);

  const inlinedBase = report?.base;

  // When only the inlined base is available, use it. When a fetched base is
  // available, prefer it unless the user flipped the switcher.
  const effectiveBase = baseReport ?? inlinedBase;

  const comparisonReport = React.useMemo(
    () => (report ? compareBenchmarkReports(report.report, effectiveBase?.report ?? null) : null),
    [report, effectiveBase?.report],
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

      <ReportHeader
        repo={repo}
        sha={sha}
        baseSha={effectiveBase?.commitSha ?? null}
        prNumber={report?.prNumber ? Number(report?.prNumber) : undefined}
        baseRef={effectiveBase?.branch}
      />

      <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
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

        {baseSha && inlinedBase && (
          <InlinedBaseAlert fetchedBaseSha={baseSha} inlinedBaseSha={inlinedBase.commitSha} />
        )}

        {comparisonReport && <ComparisonReportView comparisonReport={comparisonReport} />}
      </Paper>
    </React.Fragment>
  );
}
