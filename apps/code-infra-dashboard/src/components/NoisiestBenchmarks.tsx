'use client';

import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import { styled } from '@mui/material/styles';
import {
  computeNoisiestTests,
  type NoisinessMode,
} from '@/lib/benchmark/computeNoisiestTests';
import type { BenchmarkReport } from '@/lib/benchmark/types';
import { formatMs } from '@/utils/formatters';

const ToggleSelectButton = styled(Button)(({ theme }) => ({
  minWidth: 'auto',
  padding: 0,
  fontSize: '0.75rem',
  textDecoration: 'underline',
  color: theme.vars.palette.primary.main,
  textTransform: 'none',
  '&:disabled': {
    color: theme.vars.palette.text.secondary,
    textDecoration: 'none',
  },
}));

interface NoisiestBenchmarksProps {
  reports: (BenchmarkReport | null)[];
}

const cvFormatter = new Intl.NumberFormat(undefined, {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export default function NoisiestBenchmarks({ reports }: NoisiestBenchmarksProps) {
  const [mode, setMode] = React.useState<NoisinessMode>('totalDuration');
  const [page, setPage] = React.useState(0);
  const [rowsPerPage, setRowsPerPage] = React.useState(10);
  const rows = React.useMemo(() => computeNoisiestTests(reports, mode), [reports, mode]);
  const pageRows = React.useMemo(
    () => rows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [rows, page, rowsPerPage],
  );

  React.useEffect(() => {
    setPage(0);
  }, [mode, rows.length]);

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Tests ranked by run-to-run coefficient of variation within the selected range.
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 2 }}>
        <Typography variant="caption" color="text.secondary">
          Granularity:
        </Typography>
        <ToggleSelectButton
          variant="text"
          size="small"
          onClick={() => setMode('totalDuration')}
          disabled={mode === 'totalDuration'}
        >
          total duration
        </ToggleSelectButton>
        <Typography variant="caption" color="text.secondary">
          |
        </Typography>
        <ToggleSelectButton
          variant="text"
          size="small"
          onClick={() => setMode('perRender')}
          disabled={mode === 'perRender'}
        >
          per render
        </ToggleSelectButton>
      </Box>
      {rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Not enough data to compute noisiness.
        </Typography>
      ) : (
        <React.Fragment>
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
                {pageRows.map((row) => (
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
          <TablePagination
            component="div"
            count={rows.length}
            page={page}
            onPageChange={(_event, newPage) => setPage(newPage)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(event) => {
              setRowsPerPage(parseInt(event.target.value, 10));
              setPage(0);
            }}
            rowsPerPageOptions={[10, 25, 50, 100]}
          />
        </React.Fragment>
      )}
    </Box>
  );
}
