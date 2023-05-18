import * as React from "react";
import { createComponent } from "@mui/toolpad/browser";
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, Tooltip, Legend, YAxis } from 'recharts';

export interface ChartProps {
  data: any[]
}

const colors = [
  "#1976d2",
  "#9c27b0",
  "#d32f2f",
  "#ed6c02",
  "#2f2f2f",
  "#2e7d32",
];

export const getPackages = (inData = []) => {
  const packages: string[] = [];
  if(inData && inData.length > 0) {
    Object.keys(inData[0] ?? {}).forEach(packageName => {
      if(packageName !== 'date') {
        packages.push(packageName);
      }
    });
  }

  return packages;
}

function Chart(props: ChartProps) {
  const { data } = props;
  // @ts-ignore
  let packages = getPackages(data);

  packages = packages.filter(function(item) {
    return item !== '@mui/material' && item !== '@mui/core'
  });

  return (
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
  );
}

export default createComponent(Chart, {
  argTypes: {
    data: {
      typeDef: { type: 'array' }
    }
  },
});
