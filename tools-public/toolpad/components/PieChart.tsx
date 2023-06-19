import * as React from 'react';
import { createComponent } from '@mui/toolpad-core';
import { PieChart, Pie, Cell, Tooltip } from 'recharts';

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
  data: object[];
}

function PieChartExport({ data }: PieChartProps) {
  return (
    <PieChart width={300} height={300}>
      <Pie
        data={data}
        cx={150}
        cy={150}
        innerRadius={0}
        outerRadius={80}
        fill="#8884d8"
        dataKey="value"
      >
        {data.map((entry, index) => (
          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
        ))}
      </Pie>
      <Tooltip
        formatter={(value, name, props) =>
          Intl.NumberFormat('en', { notation: 'compact' }).format(value)
        }
      />
    </PieChart>
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
});
