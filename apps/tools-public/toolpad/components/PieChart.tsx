import * as React from 'react';
import Box from '@mui/system/Box';
import { PieChart, pieArcLabelClasses } from '@mui/x-charts/PieChart';
import { createComponent } from '@toolpad/studio/browser';

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

const height = 300;
const width = 300;

function PieChartExport({ data, loading }: PieChartProps) {
  if (loading) {
    return <Box sx={{ width, height, display: 'flex', alignItems: 'center', px: 2 }}>Loading…</Box>;
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
            arcLabel: (item) => item.label!,
            arcLabelMinAngle: 30,
            valueFormatter: ({ value }) =>
              Intl.NumberFormat('en', { notation: 'compact' }).format(value),
          },
        ]}
        sx={{
          [`& .${pieArcLabelClasses.root}`]: {
            fill: 'white',
            fontWeight: 'bold',
          },
        }}
        width={width}
        height={height}
        slotProps={{ legend: { hidden: true } }}
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
  },
  loadingPropSource: ['data'],
  loadingProp: 'loading',
});
