import * as React from "react";
import { createComponent } from "@mui/toolpad-core";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "https://esm.sh/recharts@2.2.0";

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
  return (
    <LineChart
      width={800}
      height={300}
      data={data}
      margin={{
        top: 5,
        right: 30,
        left: 20,
        bottom: 5,
      }}
    >
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="event_month" />
      <YAxis />
      <Tooltip />
      <Legend />
      <Line type="monotone" dataKey="reviewed" stroke={COLORS[6]} />
      <Line type="monotone" dataKey="opened" stroke={COLORS[7]} />
    </LineChart>
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
