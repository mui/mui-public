import * as React from "react";
import { Stack, Typography } from "@mui/material";
import { createComponent } from "@mui/toolpad/browser";
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, Tooltip, Legend, YAxis } from 'recharts';

export interface ChartProps {
  data: any[];
  packages: any[];
  title: string;
}

const colors = [
  "#1976d2",
  "#9c27b0",
  "#d32f2f",
  "#ed6c02",
  "#2f2f2f",
  "#2e7d32",
];

function Chart(props: ChartProps) {
  const { data, packages = [], title } = props;

  return (
    <Stack sx={{width: '100%'}} gap={1}>
      <Typography variant="h6">{title}</Typography>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart width={800} height={300} data={data}>
          {packages.map((packageName, idx) => <Line type="monotone" dataKey={packageName} key={packageName} stroke={colors[idx]} /> )}
          <CartesianGrid stroke="#ccc" />
          <Tooltip />
          <Legend />
          <XAxis dataKey="date" />
          <YAxis width={100}/>
        </LineChart>
      </ResponsiveContainer>
    </Stack>
  );
}

export default createComponent(Chart, {
  argTypes: {
    data: {
      typeDef: { type: 'array' }
    },
    packages: {
      typeDef: { type: 'array' }
    },
    title: {
      typeDef: { type: 'string' }
    }
  },
});
