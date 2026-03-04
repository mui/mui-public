'use client';

import * as React from 'react';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import Chip from '@mui/material/Chip';
import type { CiSnapshot } from '../lib/ciAnalytics';
import { formatDuration, formatSuccessRate, getSuccessRateColor } from '../lib/ciAnalytics';

interface CiSummaryTableProps {
  snapshot: CiSnapshot;
}

export default function CiSummaryTable({ snapshot }: CiSummaryTableProps) {
  const rows = snapshot.projects.flatMap((project) =>
    project.workflows.map((workflow) => ({
      project: project.displayName,
      workflow: workflow.name,
      weekSuccessRate: workflow.week.successRate,
      monthSuccessRate: workflow.month.successRate,
      weekAvgDuration: workflow.week.avgDurationSecs,
      monthAvgDuration: workflow.month.avgDurationSecs,
      weekCredits: workflow.week.totalCredits,
      monthCredits: workflow.month.totalCredits,
      weekRuns: workflow.week.totalRuns,
      monthRuns: workflow.month.totalRuns,
    })),
  );

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Project</TableCell>
            <TableCell>Workflow</TableCell>
            <TableCell align="right">Success (week)</TableCell>
            <TableCell align="right">Success (month)</TableCell>
            <TableCell align="right">Avg Runtime (week)</TableCell>
            <TableCell align="right">Avg Runtime (month)</TableCell>
            <TableCell align="right">Credits (week)</TableCell>
            <TableCell align="right">Credits (month)</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.project}-${row.workflow}`}>
              <TableCell>{row.project}</TableCell>
              <TableCell>{row.workflow}</TableCell>
              <TableCell align="right">
                <Chip
                  label={formatSuccessRate(row.weekSuccessRate)}
                  color={getSuccessRateColor(row.weekSuccessRate)}
                  size="small"
                  variant="outlined"
                />
              </TableCell>
              <TableCell align="right">
                <Chip
                  label={formatSuccessRate(row.monthSuccessRate)}
                  color={getSuccessRateColor(row.monthSuccessRate)}
                  size="small"
                  variant="outlined"
                />
              </TableCell>
              <TableCell align="right">{formatDuration(row.weekAvgDuration)}</TableCell>
              <TableCell align="right">{formatDuration(row.monthAvgDuration)}</TableCell>
              <TableCell align="right">{Math.round(row.weekCredits).toLocaleString()}</TableCell>
              <TableCell align="right">{Math.round(row.monthCredits).toLocaleString()}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
