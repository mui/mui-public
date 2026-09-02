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
import { fetchCiReport } from '@/utils/fetchCiReport';
import type { ConfidenceInterval, TachometerUpload, Verdict } from '@/lib/tachometer/types';
import {
  bytesPerVariant,
  groupCasesByVariantSet,
  shortNameOf,
} from '@/lib/tachometer/groupCases';
import type { SummarizedCase } from '@/lib/tachometer/groupCases';
import Heading from '../components/Heading';
import ReportHeader from '../components/ReportHeader';
import ErrorDisplay from '../components/ErrorDisplay';

/**
 * The tables the run prints in CI, as HTML: cases grouped by their variant set, a group of two
 * variants read down its measurements, a group of more read across its variants.
 *
 * Deliberately plain — no charts or bars. A confidence interval is two numbers and a verdict, and
 * drawing it as a length invites reading the picture as significance when the interval is what
 * actually carries that.
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

/** Only a resolved difference is coloured; `unsure` is the expected result and stays neutral. */
function verdictColor(verdict: Verdict): 'error' | 'success' | 'text.secondary' {
  if (verdict === 'slower') {
    return 'error';
  }
  if (verdict === 'faster') {
    return 'success';
  }
  return 'text.secondary';
}

/** Auto-sampling stops per case, so the counts are normally equal; when they are not, say both. */
function formatSamples(samples: number[]): string {
  return [...new Set(samples)].join('/');
}

function VerdictText({
  verdict,
  percentChange,
}: {
  verdict: Verdict;
  percentChange: ConfidenceInterval;
}) {
  return (
    <Typography variant="body2" color={verdictColor(verdict)} component="span">
      {verdict} {formatPercent(percentChange)}
    </Typography>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="body2" color="text.secondary" component="span">
      {children}
    </Typography>
  );
}

/**
 * One case as a table of variants, for a comparison with more than two of them.
 *
 * Rows are variants, not measurements: with several libraries, a column per variant plus a Δ column
 * per pair would run off the page. Each measurement then shows the variant's interval next to its
 * difference relative to the reference — the direction a row about that library reads in.
 */
function VariantTable({ entry, variants }: { entry: SummarizedCase; variants: string[] }) {
  const [reference] = variants;

  return (
    <TableContainer sx={{ mb: 4, overflowX: 'auto' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>{entry.name}</TableCell>
            {entry.measurements.map((measurement) => (
              <React.Fragment key={measurement.name}>
                <TableCell align="right">{measurement.name}</TableCell>
                <TableCell>vs {reference}</TableCell>
              </React.Fragment>
            ))}
            <TableCell align="right">Transferred</TableCell>
            <TableCell align="right">Samples</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {variants.map((variantName) => {
            const samples: number[] = [];
            let bytesSent: number | undefined;

            const cells = entry.measurements.map((measurement) => {
              const found = measurement.variants.find(
                (candidate) => shortNameOf(entry.name, candidate.variant) === variantName,
              );
              const comparison = measurement.comparisons.find(
                (candidate) => shortNameOf(entry.name, candidate.variant) === variantName,
              );
              if (found) {
                bytesSent = found.bytesSent;
                samples.push(found.samples);
              }
              // The comparison holds the reference relative to this variant; a row about the
              // variant needs the direction whose subject is the variant.
              const againstReference = comparison?.versusReference;
              return (
                <React.Fragment key={measurement.name}>
                  <TableCell align="right">
                    {found ? formatMean(found.meanMs) : <Muted>—</Muted>}
                  </TableCell>
                  <TableCell>
                    {variantName === reference && <Muted>reference</Muted>}
                    {variantName !== reference && againstReference && (
                      <VerdictText
                        verdict={againstReference.verdict}
                        percentChange={againstReference.percentChange}
                      />
                    )}
                    {variantName !== reference && !againstReference && <Muted>—</Muted>}
                  </TableCell>
                </React.Fragment>
              );
            });

            return (
              <TableRow key={variantName}>
                <TableCell>{variantName}</TableCell>
                {cells}
                <TableCell align="right">
                  {bytesSent === undefined ? <Muted>—</Muted> : formatBytes(bytesSent)}
                </TableCell>
                <TableCell align="right">{formatSamples(samples)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

/**
 * A group of cases sharing a variant set, one row per case and measurement.
 *
 * Each variant gets a column of its own, followed by the difference of the reference against it —
 * which is the direction a regression is stated in, and what the Δ heading names.
 */
function CaseGroupTable({ cases, variants }: { cases: SummarizedCase[]; variants: string[] }) {
  const [reference, ...others] = variants;

  return (
    <TableContainer sx={{ mb: 4, overflowX: 'auto' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Case</TableCell>
            <TableCell>Measurement</TableCell>
            {variants.map((variantName) => (
              <TableCell key={variantName} align="right">
                {variantName}
              </TableCell>
            ))}
            {others.map((variantName) => (
              <TableCell key={variantName}>Δ vs {variantName}</TableCell>
            ))}
            <TableCell align="right">Samples</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {cases.flatMap((entry, caseIndex) =>
            entry.measurements.map((measurement, measurementIndex) => {
              const byVariant = new Map(
                measurement.variants.map((variant) => [
                  shortNameOf(entry.name, variant.variant),
                  variant,
                ]),
              );
              const byComparison = new Map(
                measurement.comparisons.map((comparison) => [
                  shortNameOf(entry.name, comparison.variant),
                  comparison,
                ]),
              );
              // A rule where the next case starts, since its name only appears on its first row.
              const startsCase = measurementIndex === 0 && caseIndex > 0;

              return (
                <TableRow
                  key={`${entry.name}-${measurement.name}`}
                  sx={startsCase ? { '& td': { borderTop: 1, borderTopColor: 'divider' } } : null}
                >
                  <TableCell>{measurementIndex === 0 ? entry.name : ''}</TableCell>
                  <TableCell>{measurement.name}</TableCell>
                  {variants.map((variantName) => {
                    const found = byVariant.get(variantName);
                    return (
                      <TableCell key={variantName} align="right">
                        {found ? formatMean(found.meanMs) : <Muted>—</Muted>}
                      </TableCell>
                    );
                  })}
                  {others.map((variantName) => {
                    const comparison = byComparison.get(variantName);
                    return (
                      <TableCell key={variantName}>
                        {comparison ? (
                          <VerdictText
                            verdict={comparison.verdict}
                            percentChange={comparison.percentChange}
                          />
                        ) : (
                          <Muted>—</Muted>
                        )}
                      </TableCell>
                    );
                  })}
                  <TableCell align="right">
                    {formatSamples(measurement.variants.map((variant) => variant.samples))}
                  </TableCell>
                </TableRow>
              );
            }),
          )}
        </TableBody>
      </Table>
      <Muted>
        Δ is tachometer&apos;s confidence interval on the difference, {reference} relative to the
        other variant{others.length > 1 ? 's' : ''} — negative is faster.
      </Muted>
    </TableContainer>
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
    (entry): entry is SummarizedCase =>
      entry.measurements !== undefined && entry.measurements.length > 0,
  );
  const failed = (report?.cases ?? []).filter((entry) => !entry.measurements?.length);
  const groups = groupCasesByVariantSet(summarized);

  // Bundle weight is a property of the variant's page, not of a measurement, so it goes in a note
  // rather than down every row — except where the variant table already gives it a column.
  const withBytesColumn = new Set(
    groups.filter((group) => group.variants.length > 2).flatMap((group) => group.cases),
  );

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

        {groups.map((group) =>
          group.variants.length > 2 ? (
            group.cases.map((entry) => (
              <VariantTable key={entry.name} entry={entry} variants={group.variants} />
            ))
          ) : (
            <CaseGroupTable
              key={group.variants.join('|')}
              cases={group.cases}
              variants={group.variants}
            />
          ),
        )}

        {report && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Muted>
              Each cell is a 95% confidence interval for the mean, in milliseconds; one sample is
              one page load. &quot;unsure&quot; means the interval still straddles zero: the
              difference did not resolve within the case&apos;s sampling budget.
            </Muted>
            {summarized
              .filter((entry) => !withBytesColumn.has(entry))
              .map((entry) => (
                <Muted key={entry.name}>
                  {entry.name} transferred:{' '}
                  {bytesPerVariant(entry)
                    .map(([variantName, bytes]) => `${variantName} ${formatBytes(bytes)}`)
                    .join('  ·  ')}
                </Muted>
              ))}
            <Muted>
              Builds:{' '}
              {report.refs
                .map(
                  (ref) => `${ref.id} = ${ref.label}${ref.sha ? ` (${ref.sha.slice(0, 9)})` : ''}`,
                )
                .join('  ·  ')}
            </Muted>
            <Muted>
              head: {report.head.sha.slice(0, 9)} ({report.head.branch || '?'}) · measured on the
              production bundle, installed from a packed tarball.
            </Muted>
          </Box>
        )}
      </Paper>
    </React.Fragment>
  );
}
