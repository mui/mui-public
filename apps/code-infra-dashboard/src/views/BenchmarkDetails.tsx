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
import Heading from '../components/Heading';
import ErrorDisplay from '../components/ErrorDisplay';
import {
  fetchBenchmarkReport,
  type BenchmarkReportEntry,
  type RenderStats,
} from '../utils/fetchBenchmarkReport';

const durationFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMs(value: number): string {
  return `${durationFormatter.format(value)} ms`;
}

/**
 * Horizontal stacked bar showing each render positioned by startTime.
 * Renders a flame-chart-like visualization for a single benchmark entry.
 */
function RenderTimeline({ entry }: { entry: BenchmarkReportEntry }) {
  const maxTime = Math.max(...entry.renders.map((r) => r.startTime + r.actualDuration));

  if (maxTime === 0) {
    return null;
  }

  const COLORS = [
    '#1976d2',
    '#d32f2f',
    '#2e7d32',
    '#ed6c02',
    '#9c27b0',
    '#00796b',
    '#f57c00',
    '#5d4037',
  ];

  return (
    <Box
      sx={{
        position: 'relative',
        height: 32,
        backgroundColor: 'grey.100',
        borderRadius: 1,
        overflow: 'hidden',
        mb: 1,
      }}
    >
      {entry.renders.map((render, index) => {
        const left = (render.startTime / maxTime) * 100;
        const width = Math.max((render.actualDuration / maxTime) * 100, 0.5);
        return (
          <Box
            key={`${render.id}-${render.phase}`}
            title={`${render.id} (${render.phase}): ${formatMs(render.actualDuration)}`}
            sx={{
              position: 'absolute',
              top: 2,
              bottom: 2,
              left: `${left}%`,
              width: `${width}%`,
              backgroundColor: COLORS[index % COLORS.length],
              borderRadius: 0.5,
              opacity: 0.85,
              minWidth: 2,
            }}
          />
        );
      })}
    </Box>
  );
}

function BenchmarkEntryDetail({ name, entry }: { name: string; entry: BenchmarkReportEntry }) {
  return (
    <Paper elevation={1} sx={{ p: 2, mb: 2 }}>
      <Typography variant="subtitle1" gutterBottom fontWeight={600}>
        {name}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {entry.iterations} iterations, total {formatMs(entry.totalDuration)}
      </Typography>

      <RenderTimeline entry={entry} />

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
                <TableCell>{render.phase}</TableCell>
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

export default function BenchmarkDetails() {
  const params = useParams<{ owner: string; repo: string }>();
  const searchParams = useSearchParams();

  if (!params.owner || !params.repo) {
    throw new Error('Missing required path parameters');
  }

  const repo = `${params.owner}/${params.repo}`;
  const sha = searchParams.get('sha');

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

        {report &&
          Object.entries(report).map(([name, entry]: [string, BenchmarkReportEntry]) => (
            <BenchmarkEntryDetail key={name} name={name} entry={entry} />
          ))}
      </Paper>
    </React.Fragment>
  );
}
