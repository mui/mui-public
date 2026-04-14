'use client';

import * as React from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Alert from '@mui/material/Alert';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Box from '@mui/material/Box';
import { fetchCiReport } from '@/utils/fetchCiReport';
import Heading from '../components/Heading';
import ReportHeader from '../components/ReportHeader';
import ErrorDisplay from '../components/ErrorDisplay';
import { BenchmarkComparisonReportView } from '../components/BenchmarkComparisonReportView';
import { useBaseSha } from '../hooks/useBaseSha';

export default function BenchmarkDetails() {
  const params = useParams<{ owner: string; repo: string }>();
  const searchParams = useSearchParams();

  if (!params.owner || !params.repo) {
    throw new Error('Missing required path parameters');
  }

  const repo = `${params.owner}/${params.repo}`;
  const sha = searchParams.get('sha');
  const prNumber = searchParams.get('prNumber');
  const baseRef = searchParams.get('baseRef');

  const { baseSha, isLoading: isBaseResolving } = useBaseSha(repo, sha);

  const {
    data: report,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['benchmark-report', repo, sha],
    queryFn: () => fetchCiReport(repo, sha!, 'benchmark.json'),
    retry: 1,
    enabled: Boolean(sha),
  });

  const {
    data: baseReport,
    isLoading: isBaseLoading,
    error: baseError,
  } = useQuery({
    queryKey: ['benchmark-report', repo, baseSha],
    queryFn: () => fetchCiReport(repo, baseSha!, 'benchmark.json'),
    retry: 1,
    enabled: Boolean(baseSha),
  });

  const reportNotFound = !isLoading && !error && report === null && Boolean(sha);
  const baseNotFound = !isBaseLoading && !baseError && baseReport === null && Boolean(baseSha);

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

  const effectiveBaseSha = baseSha && !baseNotFound ? baseSha : null;

  return (
    <React.Fragment>
      <Heading level={1}>Benchmark Details</Heading>

      {!isBaseResolving && (
        <ReportHeader
          repo={repo}
          sha={sha}
          baseSha={effectiveBaseSha}
          prNumber={prNumber ? Number(prNumber) : undefined}
          baseRef={baseRef ?? undefined}
        />
      )}

      <Paper elevation={2} sx={{ p: 3, mb: 3 }}>
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

        {report && <BenchmarkComparisonReportView value={report} base={baseReport ?? null} />}
      </Paper>
    </React.Fragment>
  );
}
