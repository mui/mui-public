import * as React from 'react';
import { PieChart } from '@mui/x-charts/PieChart';
import { createComponent } from '@mui/toolpad/browser';

// Copied from https://wpdatatables.com/data-visualization-color-palette/
const COLORS = [
  '#ea5545',
  '#f46a9b',
  '#ef9b20',
  '#edbf33',
  '#ede15b',
  '#bdcf32',
  '#87bc45',
  '#27aeef',
  '#b33dc6',
];

export interface PieChartProps {
  data: any[];
  loading: boolean;
}

function PieChartExport({ data, loading }: PieChartProps) {
  if (loading) {
    return null;
  }

  return (
    <div>
      <PieChart
        series={[
          {
            data: data.map((entry, index) => ({
              id: index,
              label: entry.name,
              color: COLORS[index % COLORS.length],
              value: entry.value,
            })),
            valueFormatter: ({ value }) =>
              Intl.NumberFormat('en', { notation: 'compact' }).format(value),
          },
        ]}
        width={300}
        height={300}
      />
    </div>
  );
}

export default createComponent(PieChartExport, {
  argTypes: {
    data: {
      type: 'array',
      default: [
        { name: 'Group A', value: 400 },
        { name: 'Group B', value: 300 },
        { name: 'Group C', value: 300 },
        { name: 'Group D', value: 200 },
      ],
    },
    loading: {
      type: 'boolean',
      default: false,
    },
  },
});
