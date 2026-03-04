'use client';

import * as React from 'react';
import Box from '@mui/material/Box';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select, { type SelectChangeEvent } from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Alert from '@mui/material/Alert';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import Heading from '../components/Heading';
import CiSummaryTable from '../components/CiSummaryTable';
import CiDailyChart from '../components/CiDailyChart';
import CiCreditsPieChart from '../components/CiCreditsPieChart';
import { useCiAnalyticsSnapshot, useCiSnapshotIndex } from '../hooks/useCiAnalyticsSnapshot';

export default function CiAnalytics() {
  const [selectedTimestamp, setSelectedTimestamp] = React.useState<string | undefined>(undefined);
  const indexQuery = useCiSnapshotIndex();
  const snapshotQuery = useCiAnalyticsSnapshot(selectedTimestamp);

  const handleTimestampChange = (event: SelectChangeEvent) => {
    const value = event.target.value;
    setSelectedTimestamp(value === 'latest' ? undefined : value);
  };

  const timestamps = indexQuery.data ?? [];

  return (
    <Box sx={{ mt: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Heading level={1} sx={{ mb: 0 }}>
          CI Analytics
        </Heading>
        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel>Snapshot</InputLabel>
          <Select
            value={selectedTimestamp ?? 'latest'}
            onChange={handleTimestampChange}
            label="Snapshot"
          >
            <MenuItem value="latest">Latest</MenuItem>
            {[...timestamps].reverse().map((ts) => (
              <MenuItem key={ts} value={ts}>
                {ts.replace('T', ' ').replace('Z', ' UTC')}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {snapshotQuery.error ? (
        <Alert severity="error">
          Failed to load CI analytics data: {(snapshotQuery.error as Error).message}
        </Alert>
      ) : null}

      {snapshotQuery.isLoading ? (
        <Box>
          <Skeleton variant="rectangular" height={200} sx={{ mb: 3 }} />
          <Skeleton variant="rectangular" height={350} sx={{ mb: 3 }} />
          <Skeleton variant="rectangular" height={350} />
        </Box>
      ) : null}

      {snapshotQuery.data ? (
        <React.Fragment>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Data collected: {new Date(snapshotQuery.data.collectedAt).toLocaleString()}
          </Typography>

          <Heading level={2}>Summary</Heading>
          <Box sx={{ mb: 4 }}>
            <CiSummaryTable snapshot={snapshotQuery.data} />
          </Box>

          <Heading level={2}>Daily Trends (last 30 days)</Heading>
          <Box sx={{ mb: 4 }}>
            <CiDailyChart snapshot={snapshotQuery.data} />
          </Box>

          <Heading level={2}>Monthly Credit Usage</Heading>
          <Box sx={{ mb: 4 }}>
            <CiCreditsPieChart snapshot={snapshotQuery.data} />
          </Box>
        </React.Fragment>
      ) : null}
    </Box>
  );
}
