'use client';

import * as React from 'react';
import Box from '@mui/material/Box';
import { PieChart } from '@mui/x-charts-pro';
import type { CiSnapshot } from '../lib/ciAnalytics';

const COLORS = ['#ea5545', '#f46a9b', '#ef9b20', '#edbf33', '#87bc45', '#27aeef', '#b33dc6'];

interface CiCreditsPieChartProps {
  snapshot: CiSnapshot;
}

export default function CiCreditsPieChart({ snapshot }: CiCreditsPieChartProps) {
  const data = snapshot.projects.map((project, index) => {
    const totalCredits = project.workflows.reduce((sum, wf) => sum + wf.month.totalCredits, 0);
    return {
      id: project.slug,
      label: project.displayName,
      value: Math.round(totalCredits),
      color: COLORS[index % COLORS.length],
    };
  });

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center' }}>
      <PieChart
        series={[
          {
            data,
            arcLabel: 'label',
            arcLabelMinAngle: 20,
            valueFormatter: (item) => `${item.value.toLocaleString()} credits`,
            highlightScope: { fade: 'global', highlight: 'item' },
          },
        ]}
        width={500}
        height={350}
        margin={{ top: 40, right: 40, bottom: 40, left: 40 }}
        hideLegend
      />
    </Box>
  );
}
