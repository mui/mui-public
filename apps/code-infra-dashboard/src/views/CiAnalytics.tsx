'use client';

import * as React from 'react';
import Box from '@mui/material/Box';
import Alert from '@mui/material/Alert';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import { useSearchParams } from 'next/navigation';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import type { CreditsPeriod } from '../components/CiCreditsPieChart';
import CiCreditsPieChart from '../components/CiCreditsPieChart';
import Heading from '../components/Heading';
import CiWorkflowCard, { computeWorkflowAnalysis } from '../components/CiSummaryTable';
import { useCiAnalyticsSnapshot, useCiSnapshotIndex } from '../hooks/useCiAnalyticsSnapshot';
import { formatDuration, formatSuccessRate, getSnapshotUrl } from '../lib/ciAnalytics';

function getCircleCiInsightsUrl(slug: string, workflow: string): string {
  const orgRepo = slug.replace(/^gh\//, '');
  return `https://app.circleci.com/insights/github/${orgRepo}/workflows/${workflow}/overview?branch=master`;
}

function buildMarkdownReport(
  projects: {
    slug: string;
    displayName: string;
    workflows: Parameters<typeof computeWorkflowAnalysis>[0][];
  }[],
  dashboardSource: string,
): string {
  const SEVERITY_EMOJI: Record<string, string> = {
    error: '\uD83D\uDD34',
    warning: '\uD83D\uDFE1',
  };
  const GREEN = '\uD83D\uDFE2';

  const lines = projects
    .flatMap((project) =>
      project.workflows.map((wf) => {
        const analysis = computeWorkflowAnalysis(wf);
        const emoji = analysis.severity ? SEVERITY_EMOJI[analysis.severity] : GREEN;
        const success = formatSuccessRate(analysis.successRate);
        const runtime = formatDuration(analysis.runtimeSecs);
        const url = getCircleCiInsightsUrl(project.slug, wf.name);
        return `  ${emoji} [${project.displayName} / ${wf.name}](${url}) \u2014 ${success} success, ${runtime}`;
      }),
    )
    .join('\n');

  const dashboardUrl = `${window.location.origin}/ci-analytics?source=${encodeURIComponent(dashboardSource)}&reporting-window=last-7-days`;

  return `*Weekly CI report:*\n${lines}\nMore details available in the [dashboard](${dashboardUrl})`;
}

function MarkdownReport({
  projects,
  source,
}: {
  projects: {
    slug: string;
    displayName: string;
    workflows: Parameters<typeof computeWorkflowAnalysis>[0][];
  }[];
  source: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const reportText = buildMarkdownReport(projects, source);

  const handleCopy = () => {
    navigator.clipboard.writeText(reportText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Accordion sx={{ mb: 3 }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Box sx={{ display: 'flex', alignItems: 'center', flex: 1 }}>
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            Markdown Report
          </Typography>
          <Tooltip title={copied ? 'Copied!' : 'Copy to clipboard'}>
            <IconButton
              size="small"
              onClick={(event) => {
                event.stopPropagation();
                handleCopy();
              }}
              color={copied ? 'success' : 'default'}
            >
              {copied ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Box>
      </AccordionSummary>
      <AccordionDetails>
        <Typography
          component="pre"
          sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.8rem' }}
        >
          {reportText}
        </Typography>
      </AccordionDetails>
    </Accordion>
  );
}

function SnapshotReport({ source }: { source: string }) {
  const [creditsPeriod, setCreditsPeriod] = React.useState<CreditsPeriod>('week');
  const snapshotQuery = useCiAnalyticsSnapshot(source);

  return (
    <React.Fragment>
      {snapshotQuery.error ? (
        <Alert severity="error">
          Failed to load CI analytics data: {(snapshotQuery.error as Error).message}
        </Alert>
      ) : null}

      {snapshotQuery.isLoading ? (
        <React.Fragment>
          <Skeleton variant="text" width={250} sx={{ mb: 3, fontSize: '0.875rem' }} />
          <Grid container spacing={3}>
            {Array.from({ length: 3 }, (_, i) => (
              <Grid key={i} size={{ xs: 12, md: 6, lg: 4 }}>
                <Card variant="outlined">
                  <CardContent>
                    <Skeleton variant="text" width="60%" sx={{ fontSize: '1.25rem', mb: 2 }} />
                    <Skeleton variant="text" width="80%" sx={{ mb: 0.5 }} />
                    <Skeleton variant="text" width="70%" sx={{ mb: 0.5 }} />
                    <Skeleton variant="text" width="75%" />
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>
          <Typography variant="h6" sx={{ mt: 4, textAlign: 'center' }}>
            <Skeleton variant="text" width={120} sx={{ mx: 'auto' }} />
          </Typography>
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
            <Skeleton variant="circular" width={280} height={280} />
          </Box>
        </React.Fragment>
      ) : null}

      {snapshotQuery.data ? (
        <React.Fragment>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Data collected: {new Date(snapshotQuery.data.collectedAt).toLocaleString()}
          </Typography>
          <MarkdownReport projects={snapshotQuery.data.projects} source={source} />
          <Grid container spacing={3}>
            {snapshotQuery.data.projects.flatMap((project) =>
              project.workflows.map((workflow) => (
                <Grid key={`${project.slug}/${workflow.name}`} size={{ xs: 12, md: 6, lg: 4 }}>
                  <CiWorkflowCard slug={project.slug} workflow={workflow} />
                </Grid>
              )),
            )}
          </Grid>
          <Typography variant="h6" sx={{ mt: 4, textAlign: 'center' }}>
            Credits Usage
          </Typography>
          <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1 }}>
            <ToggleButtonGroup
              value={creditsPeriod}
              exclusive
              onChange={(_, value) => {
                if (value) {
                  setCreditsPeriod(value);
                }
              }}
              size="small"
              sx={{ '& .MuiToggleButton-root': { py: 0.25, px: 1, fontSize: '0.75rem' } }}
            >
              <ToggleButton value="week">Last Week</ToggleButton>
              <ToggleButton value="month">Last Month</ToggleButton>
            </ToggleButtonGroup>
          </Box>
          <CiCreditsPieChart snapshot={snapshotQuery.data} period={creditsPeriod} />
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

      <List>
        <ListItem>
          <Link href="?source=/api/ci-analytics/collect">Live report</Link>
        </ListItem>
        {indexQuery.isLoading
          ? Array.from({ length: 3 }, (_, i) => (
              <ListItem key={i}>
                <Skeleton variant="text" width={200} />
              </ListItem>
            ))
          : null}
        {indexQuery.data
          ? [...indexQuery.data].reverse().map((ts) => (
              <ListItem key={ts}>
                <Link href={`?source=${encodeURIComponent(getSnapshotUrl(ts))}`}>
                  {ts.replace('T', ' ').replace('Z', ' UTC')}
                </Link>
              </ListItem>
            ))
          : null}
      </List>
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
