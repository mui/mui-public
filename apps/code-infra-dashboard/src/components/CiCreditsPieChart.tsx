'use client';

import * as React from 'react';
import { PieChart } from '@mui/x-charts-pro/PieChart';
import type { CiSnapshot } from '../lib/ciAnalytics';

const OTHER_COLOR = '#bdbdbd';

// Distinct base hues for projects (hsl hue values)
const PROJECT_HUES = [210, 150, 30, 350, 270, 60, 180, 330, 90, 300];

function projectColor(index: number): string {
  const hue = PROJECT_HUES[index % PROJECT_HUES.length];
  return `hsl(${hue}, 65%, 50%)`;
}

function workflowShade(projectIndex: number, shadeIndex: number, total: number): string {
  const hue = PROJECT_HUES[projectIndex % PROJECT_HUES.length];
  // Spread lightness from 35% (dark) to 65% (light) across workflows
  const lightness = total <= 1 ? 50 : 35 + (shadeIndex / (total - 1)) * 30;
  return `hsl(${hue}, 65%, ${Math.round(lightness)}%)`;
}

export type CreditsPeriod = 'week' | 'month';

interface CiCreditsPieChartProps {
  snapshot: CiSnapshot;
  period?: CreditsPeriod;
}

export default function CiCreditsPieChart({ snapshot, period = 'week' }: CiCreditsPieChartProps) {
  // Build per-project groups so inner and outer rings can be sorted together
  const groups: {
    inner: { id: string; value: number; label: string; color: string };
    outer: { data: { id: string; value: number; color: string }[]; labels: string[] };
  }[] = [];

  snapshot.projects.forEach((project, projectIndex) => {
    const projectTotal = project.projectCredits?.[period] ?? 0;
    const color = projectColor(projectIndex);

    const outerSlices: { id: string; value: number; color: string }[] = [];
    const outerSliceLabels: string[] = [];

    // Count total outer slices for this project (workflows + possible "other")
    let trackedCredits = 0;
    for (const wf of project.workflows) {
      trackedCredits += wf.allBranchCredits?.[period] ?? 0;
    }
    const hasOtherWf = projectTotal - trackedCredits > 0;
    const totalSlices = project.workflows.length + (hasOtherWf ? 1 : 0);

    // Tracked workflows (no label so they don't appear in legend)
    project.workflows.forEach((wf, wfIndex) => {
      const credits = wf.allBranchCredits?.[period] ?? 0;
      outerSliceLabels.push(`${project.displayName} / ${wf.name}`);
      outerSlices.push({
        id: `${project.slug}/${wf.name}`,
        value: credits,
        color: workflowShade(projectIndex, wfIndex, totalSlices),
      });
    });

    // "Other workflows" slice
    const otherWf = projectTotal - trackedCredits;
    if (otherWf > 0) {
      outerSliceLabels.push(`${project.displayName} / Other workflows`);
      outerSlices.push({
        id: `${project.slug}/__other_wf`,
        value: otherWf,
        color: workflowShade(projectIndex, project.workflows.length, totalSlices),
      });
    }

    groups.push({
      inner: { id: project.slug, value: projectTotal, label: project.displayName, color },
      outer: { data: outerSlices, labels: outerSliceLabels },
    });
  });

  // "Other projects" slice
  const projectsTotal = groups.reduce((sum, g) => sum + g.inner.value, 0);
  const orgTotal = snapshot.orgCredits?.[period] ?? 0;
  const otherProjects = orgTotal - projectsTotal;

  if (otherProjects > 0) {
    groups.push({
      inner: {
        id: '__other_projects',
        value: otherProjects,
        label: 'Other projects',
        color: OTHER_COLOR,
      },
      outer: {
        data: [{ id: '__other_projects_outer', value: otherProjects, color: OTHER_COLOR }],
        labels: ['Other projects'],
      },
    });
  }

  // Sort by credits descending, with "Other projects" always last
  groups.sort((a, b) => {
    if (a.inner.id === '__other_projects') {
      return 1;
    }
    if (b.inner.id === '__other_projects') {
      return -1;
    }
    return b.inner.value - a.inner.value;
  });

  // Flatten groups into final arrays
  const innerData = groups.map((g) => g.inner);
  const outerData = groups.flatMap((g) => g.outer.data);
  const outerLabels = groups.flatMap((g) => g.outer.labels);

  const creditFormatter = (v: { value: number }) =>
    `${Math.round(v.value).toLocaleString()} credits`;

  const outerFormatter = (v: { value: number }, { dataIndex }: { dataIndex: number }) =>
    `${outerLabels[dataIndex]}: ${Math.round(v.value).toLocaleString()} credits`;

  return (
    <PieChart
      series={[
        {
          data: innerData,
          outerRadius: 80,
          highlightScope: { fade: 'global', highlight: 'item' },
          valueFormatter: creditFormatter,
        },
        {
          data: outerData,
          innerRadius: 90,
          outerRadius: 140,
          highlightScope: { fade: 'global', highlight: 'item' },
          valueFormatter: outerFormatter,
        },
      ]}
      width={350}
      height={350}
    />
  );
}
