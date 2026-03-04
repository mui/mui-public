'use client';

import * as React from 'react';
import Box from '@mui/material/Box';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import { BarChart } from '@mui/x-charts-pro';
import type { CiSnapshot } from '../lib/ciAnalytics';

function getBarColor(successRate: number): string {
  if (successRate >= 0.95) {
    return '#4caf50';
  }
  if (successRate >= 0.8) {
    return '#ff9800';
  }
  return '#f44336';
}

interface CiDailyChartProps {
  snapshot: CiSnapshot;
}

export default function CiDailyChart({ snapshot }: CiDailyChartProps) {
  const options = snapshot.projects.flatMap((project) =>
    project.workflows.map((workflow) => ({
      key: `${project.slug}/${workflow.name}`,
      label: `${project.displayName} - ${workflow.name}`,
      daily: workflow.daily,
    })),
  );

  const [selected, setSelected] = React.useState(options[0]?.key ?? '');

  const handleChange = (event: SelectChangeEvent) => {
    setSelected(event.target.value);
  };

  const selectedOption = options.find((o) => o.key === selected);
  const daily = selectedOption?.daily ?? [];

  const dates = daily.map((d) => d.date);
  const durations = daily.map((d) => d.avgDurationSecs / 60);
  const colors = daily.map((d) => getBarColor(d.successRate));

  return (
    <Box>
      <FormControl size="small" sx={{ minWidth: 250, mb: 2 }}>
        <InputLabel>Project / Workflow</InputLabel>
        <Select value={selected} onChange={handleChange} label="Project / Workflow">
          {options.map((option) => (
            <MenuItem key={option.key} value={option.key}>
              {option.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {daily.length > 0 ? (
        <BarChart
          xAxis={[
            {
              data: dates,
              scaleType: 'band',
              label: 'Date',
              tickLabelStyle: { angle: -45, textAnchor: 'end' },
            },
          ]}
          yAxis={[{ label: 'Avg Duration (min)' }]}
          series={[
            {
              data: durations,
              label: 'Avg Duration',
              color: colors[0],
              valueFormatter: (value) => (value !== null ? `${value.toFixed(1)} min` : ''),
            },
          ]}
          height={350}
          barLabel={(item) => {
            const d = daily[item.dataIndex];
            return d ? `${(d.successRate * 100).toFixed(0)}%` : '';
          }}
          slotProps={{
            barLabel: {
              style: { fontSize: 10 },
            },
          }}
        />
      ) : (
        <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
          No daily data available for the selected workflow
        </Box>
      )}
    </Box>
  );
}
