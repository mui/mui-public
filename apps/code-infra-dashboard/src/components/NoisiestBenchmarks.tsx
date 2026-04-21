'use client';

import * as React from 'react';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import { computeNoisiestTests } from '@/lib/benchmark/computeNoisiestTests';
import { formatMs } from '@/utils/formatters';
import { useDailyCommits } from '../hooks/useDailyCommits';
import { useCiReports } from '../hooks/useCiReports';

interface NoisiestBenchmarksProps {
  repo: string;
}

const cvFormatter = new Intl.NumberFormat(undefined, {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export default function NoisiestBenchmarks({ repo }: NoisiestBenchmarksProps) {
  const { dailyCommits } = useDailyCommits(repo);
  const { reports } = useCiReports(repo, dailyCommits, 'benchmark.json');

  const rows = React.useMemo(() => {
    const orderedReports = dailyCommits.map(({ commit }) => reports[commit.sha]?.report ?? null);
    return computeNoisiestTests(orderedReports);
  }, [dailyCommits, reports]);

  if (rows.length === 0) {
    return null;
  }

  return (
    <Paper elevation={2} sx={{ p: 3, mt: 3 }}>
      <Typography variant="h6" component="h2" gutterBottom>
        Noisiest tests
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Tests ranked by run-to-run coefficient of variation of duration over the loaded history.
      </Typography>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Test</TableCell>
              <TableCell align="right">Runs</TableCell>
              <TableCell align="right">Mean</TableCell>
              <TableCell align="right">Stdev</TableCell>
              <TableCell align="right">CV</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.name}>
                <TableCell>{row.name}</TableCell>
                <TableCell align="right">{row.runs}</TableCell>
                <TableCell align="right">{formatMs(row.mean)}</TableCell>
                <TableCell align="right">{formatMs(row.stdDev)}</TableCell>
                <TableCell align="right">{cvFormatter.format(row.cv)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}
