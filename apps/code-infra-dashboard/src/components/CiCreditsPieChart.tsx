'use client';

import * as React from 'react';
import { PieChart } from '@mui/x-charts-pro/PieChart';
import type { CiSnapshot } from '../lib/ciAnalytics';

interface CiCreditsPieChartProps {
  snapshot: CiSnapshot;
}

export default function CiCreditsPieChart({ snapshot }: CiCreditsPieChartProps) {
  const slices: { id: string; value: number; label: string; color?: string }[] =
    snapshot.projects.flatMap((project) =>
      project.workflows
        .filter((wf) => wf.allBranchCredits != null)
        .map((wf) => {
          const label = `${project.slug} / ${wf.name}`;
          return { id: `${project.slug}/${wf.name}`, value: wf.allBranchCredits!.week, label };
        }),
    );

  const monitoredTotal = slices.reduce((sum, s) => sum + s.value, 0);

  if (snapshot.orgCredits?.week) {
    const other = snapshot.orgCredits.week - monitoredTotal;
    if (other > 0) {
      slices.push({ id: 'other', value: other, label: 'Other', color: '#bdbdbd' });
    }
  }

  return (
    <PieChart
      series={[
        {
          data: slices,
          highlightScope: { fade: 'global', highlight: 'item' },
          valueFormatter: (v) => `${Math.round(v.value).toLocaleString()} credits`,
        },
      ]}
      height={300}
    />
  );
}
