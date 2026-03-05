'use client';

import * as React from 'react';
import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import { useSearchParams } from 'next/navigation';
import Heading from '../components/Heading';
import CiCreditsPieChart from '../components/CiCreditsPieChart';
import CiWorkflowCard from '../components/CiSummaryTable';
import { useCiAnalyticsSnapshot, useCiSnapshotIndex } from '../hooks/useCiAnalyticsSnapshot';
import { getSnapshotUrl } from '../lib/ciAnalytics';

function SnapshotReport({ source }: { source: string }) {
  const snapshotQuery = useCiAnalyticsSnapshot(source);

  return (
    <React.Fragment>
      {snapshotQuery.error ? (
        <Alert severity="error">
          Failed to load CI analytics data: {(snapshotQuery.error as Error).message}
        </Alert>
      ) : null}

      {snapshotQuery.isLoading ? (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} variant="rectangular" width={400} height={300} />
          ))}
        </Box>
      ) : null}

      {snapshotQuery.data ? (
        <React.Fragment>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Data collected: {new Date(snapshotQuery.data.collectedAt).toLocaleString()}
          </Typography>

          <CiCreditsPieChart snapshot={snapshotQuery.data} />

          <Grid container spacing={3}>
            {snapshotQuery.data.projects.flatMap((project) =>
              project.workflows.map((workflow) => (
                <Grid key={`${project.slug}/${workflow.name}`} size={{ xs: 12, md: 6, lg: 4 }}>
                  <CiWorkflowCard slug={project.slug} workflow={workflow} />
                </Grid>
              )),
            )}
          </Grid>
        </React.Fragment>
      ) : null}
    </React.Fragment>
  );
}

function SnapshotIndex() {
  const indexQuery = useCiSnapshotIndex();

  return (
    <React.Fragment>
      {indexQuery.error ? (
        <Alert severity="error">
          Failed to load snapshot index: {(indexQuery.error as Error).message}
        </Alert>
      ) : null}

      {indexQuery.isLoading ? <Skeleton variant="rectangular" height={200} /> : null}

      {indexQuery.data ? (
        <List>
          <ListItem>
            <Link href="?source=/dummy-report.json">Local dummy report</Link>
          </ListItem>
          {[...indexQuery.data].reverse().map((ts) => (
            <ListItem key={ts}>
              <Link href={`?source=${encodeURIComponent(getSnapshotUrl(ts))}`}>
                {ts.replace('T', ' ').replace('Z', ' UTC')}
              </Link>
            </ListItem>
          ))}
        </List>
      ) : null}
    </React.Fragment>
  );
}

export default function CiAnalytics() {
  const searchParams = useSearchParams();
  const source = searchParams.get('source') ?? undefined;

  return (
    <Box sx={{ mt: 4 }}>
      <Heading level={1}>CI Analytics</Heading>
      {source ? <SnapshotReport source={source} /> : <SnapshotIndex />}
    </Box>
  );
}
