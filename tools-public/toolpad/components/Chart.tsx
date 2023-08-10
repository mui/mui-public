import * as React from 'react';
import { createComponent } from '@mui/toolpad/browser';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import CircularProgress from '@mui/material/CircularProgress';

// Copied from https://wpdatatables.com/data-visualization-color-palette/
const COLORS = [
  '#87bc45',
  '#27aeef',
  '#ea5545',
  '#f46a9b',
  '#ef9b20',
  '#edbf33',
  '#ede15b',
  '#bdcf32',
  '#b33dc6',
];

export interface PieChartProps {
  data: object[];
  series: string[];
  loading?: boolean;
}

function ChartExport({ loading, data, series }: PieChartProps) {
  return (
    <div style={{ position: 'relative', width: '100%', height: 300 }}>
      <ResponsiveContainer>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="event_month" />
          <YAxis />
          <Tooltip />
          <Legend />
          {series.map((serie, index) => (
            <Line
              isAnimationActive={false}
              type="monotone"
              dataKey={serie}
              stroke={COLORS[index]}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      {!data || loading ? (
        <div
          style={{
            position: 'absolute',
            inset: '0 0 0 0',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <CircularProgress />
        </div>
      ) : null}
    </div>
  );
}

export default createComponent(ChartExport, {
  loadingProp: 'loading',
  loadingPropSource: ['data', 'series'],
  argTypes: {
    data: {
      type: 'array',
      default: [],
    },
    series: {
      type: 'array',
      default: ['pr_community_count', 'pr_maintainers_count'],
    },
  },
});
