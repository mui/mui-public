import * as React from "react";
import { createComponent } from "@mui/toolpad/browser";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import CircularProgress from '@mui/material/CircularProgress';

// Copied from https://wpdatatables.com/data-visualization-color-palette/
const COLORS = [
  "#ea5545",
  "#f46a9b",
  "#ef9b20",
  "#edbf33",
  "#ede15b",
  "#bdcf32",
  "#87bc45",
  "#27aeef",
  "#b33dc6",
];

export interface PieChartProps {
  data: object[];
}

function ChartExport({ data }: PieChartProps) {
  if (!data || data.length === 0) {
    return <CircularProgress />;
  }

  return (
    <div style={{ width: '100%', height: 300 }}>
      <ResponsiveContainer>
        <LineChart
          data={data}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="event_month" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="pr_community_count" stroke={COLORS[6]} />
          <Line type="monotone" dataKey="pr_maintainers_count" stroke={COLORS[7]} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default createComponent(ChartExport, {
  argTypes: {
    data: {
      typeDef: { type: "array" },
      defaultValue: [],
    },
  },
});
