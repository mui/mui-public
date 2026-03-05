'use client';

import * as React from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import type { WorkflowMetrics, PeriodSummary } from '../lib/ciAnalytics';
import { formatDuration, formatSuccessRate } from '../lib/ciAnalytics';

const WEEK_DAYS = 7;
const MONTH_DAYS = 30;
const THRESHOLD_PCT = 5;
const LOW_SUCCESS_RATE = 0.85;

function formatDelta(delta: number): string {
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}%`;
}

function isBadDelta(delta: number, invert?: boolean): boolean {
  if (Math.abs(delta) < THRESHOLD_PCT) {
    return false;
  }
  const worsened = invert ? delta > 0 : delta < 0;
  return worsened;
}

function deltaColor(delta: number, cardHasProblems: boolean, invert?: boolean): string {
  if (isBadDelta(delta, invert)) {
    return 'error.main';
  }
  if (Math.abs(delta) >= THRESHOLD_PCT) {
    return cardHasProblems ? 'text.primary' : 'success.main';
  }
  return 'text.secondary';
}

function getCircleCiInsightsUrl(slug: string, workflow: string): string {
  // slug is e.g. "gh/mui/mui-x" → extract "mui/mui-x"
  const orgRepo = slug.replace(/^gh\//, '');
  return `https://app.circleci.com/insights/github/${orgRepo}/workflows/${workflow}/overview?branch=master`;
}

function computeDeltas(
  week: PeriodSummary,
  month: PeriodSummary,
  allBranchCredits?: { week: number; month: number },
) {
  const weekSuccessPct = week.successRate * 100;
  const monthSuccessPct = month.successRate * 100;
  const successDelta = weekSuccessPct - monthSuccessPct;

  let creditsDelta: number | null = null;
  let weekCreditsPerDay: number | null = null;
  if (allBranchCredits) {
    weekCreditsPerDay = allBranchCredits.week / WEEK_DAYS;
    const monthCreditsPerDay = allBranchCredits.month / MONTH_DAYS;
    creditsDelta =
      monthCreditsPerDay > 0
        ? ((weekCreditsPerDay - monthCreditsPerDay) / monthCreditsPerDay) * 100
        : 0;
  }

  let runtimeDelta = 0;
  if (month.avgSuccessDurationSecs > 0) {
    runtimeDelta =
      ((week.avgSuccessDurationSecs - month.avgSuccessDurationSecs) /
        month.avgSuccessDurationSecs) *
      100;
  } else if (month.avgDurationSecs > 0) {
    runtimeDelta = ((week.avgDurationSecs - month.avgDurationSecs) / month.avgDurationSecs) * 100;
  }

  return { successDelta, runtimeDelta, creditsDelta, weekCreditsPerDay };
}

function MetricRow({
  label,
  value,
  valueColor,
  delta,
  cardHasProblems,
  invert,
}: {
  label: string;
  value: React.ReactNode;
  valueColor?: string;
  delta: number;
  cardHasProblems: boolean;
  invert?: boolean;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 100 }}>
        {label}
      </Typography>
      <Typography variant="body1" sx={{ fontWeight: 'bold', color: valueColor }}>
        {value}
      </Typography>
      <Typography
        component="span"
        variant="body2"
        sx={{ color: deltaColor(delta, cardHasProblems, invert) }}
      >
        {formatDelta(delta)}
      </Typography>
      <Typography component="span" variant="body2" color="text.secondary">
        vs. 30d
      </Typography>
    </Box>
  );
}

function hasWorkflowProblems(wf: WorkflowMetrics): boolean {
  const { successDelta, runtimeDelta, creditsDelta } = computeDeltas(
    wf.week,
    wf.month,
    wf.allBranchCredits,
  );
  return (
    runtimeDelta > THRESHOLD_PCT ||
    successDelta < -THRESHOLD_PCT ||
    wf.week.successRate < LOW_SUCCESS_RATE ||
    (creditsDelta != null && creditsDelta > THRESHOLD_PCT)
  );
}

interface CiWorkflowCardProps {
  slug: string;
  workflow: WorkflowMetrics;
}

export default function CiWorkflowCard({ slug, workflow }: CiWorkflowCardProps) {
  const problem = hasWorkflowProblems(workflow);
  const { week, month } = workflow;
  const { successDelta, runtimeDelta, creditsDelta, weekCreditsPerDay } = computeDeltas(
    week,
    month,
    workflow.allBranchCredits,
  );

  const successValueColor = week.successRate < LOW_SUCCESS_RATE ? 'error.main' : undefined;

  return (
    <Card
      variant="outlined"
      sx={{
        borderColor: problem ? 'error.main' : 'success.main',
        bgcolor: problem ? 'error.50' : undefined,
      }}
    >
      <CardContent>
        <Link
          href={getCircleCiInsightsUrl(slug, workflow.name)}
          target="_blank"
          rel="noopener"
          underline="hover"
          variant="h6"
          sx={{ display: 'block', mb: 2 }}
        >
          {slug} / {workflow.name}
        </Link>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <MetricRow
            label="Success"
            value={formatSuccessRate(week.successRate)}
            valueColor={successValueColor}
            delta={successDelta}
            cardHasProblems={problem}
          />
          <MetricRow
            label="Runtime"
            value={formatDuration(week.avgSuccessDurationSecs || week.avgDurationSecs)}
            delta={runtimeDelta}
            cardHasProblems={problem}
            invert
          />
          {creditsDelta != null && weekCreditsPerDay != null ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <MetricRow
                label="Credits/day"
                value={Math.round(weekCreditsPerDay).toLocaleString()}
                delta={creditsDelta}
                cardHasProblems={problem}
                invert
              />
              {creditsDelta > THRESHOLD_PCT ? (
                <Chip
                  icon={<WarningAmberIcon />}
                  label="credits up"
                  size="small"
                  color="warning"
                  variant="outlined"
                  sx={{ height: 20, '& .MuiChip-label': { px: 0.5, fontSize: '0.65rem' } }}
                />
              ) : null}
            </Box>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
              <Typography variant="body2" color="text.secondary" sx={{ minWidth: 100 }}>
                Credits/day
              </Typography>
              <Typography variant="body2" color="text.disabled" sx={{ fontStyle: 'italic' }}>
                Insufficient data
              </Typography>
            </Box>
          )}
        </Box>

        <Accordion
          disableGutters
          elevation={0}
          sx={{
            '&::before': { display: 'none' },
            backgroundColor: 'transparent',
          }}
        >
          <AccordionSummary
            expandIcon={<ExpandMoreIcon sx={{ fontSize: '0.8rem', color: 'primary.main' }} />}
            sx={{
              minHeight: 0,
              p: 0,
              '& .MuiAccordionSummary-content': { m: 0 },
            }}
          >
            <Typography
              variant="caption"
              sx={{ fontSize: '0.65rem', color: 'primary.main', cursor: 'pointer' }}
            >
              Details
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ p: 0, pt: 0.5 }}>
            <Box
              component="table"
              sx={{
                borderCollapse: 'collapse',
                width: '100%',
                '& th, & td': {
                  px: 1,
                  py: 0.25,
                  fontSize: '0.7rem',
                  color: 'text.secondary',
                },
                '& th': { textAlign: 'left', fontWeight: 'bold' },
                '& td': { textAlign: 'right' },
              }}
            >
              <thead>
                <tr>
                  <th />
                  <td>7d</td>
                  <td>30d</td>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>Success rate</th>
                  <td>{formatSuccessRate(week.successRate)}</td>
                  <td>{formatSuccessRate(month.successRate)}</td>
                </tr>
                <tr>
                  <th>Avg runtime</th>
                  <td>{formatDuration(week.avgDurationSecs)}</td>
                  <td>{formatDuration(month.avgDurationSecs)}</td>
                </tr>
                <tr>
                  <th>Avg success runtime</th>
                  <td>{formatDuration(week.avgSuccessDurationSecs)}</td>
                  <td>{formatDuration(month.avgSuccessDurationSecs)}</td>
                </tr>
                <tr>
                  <th>Total credits</th>
                  <td>{Math.round(week.totalCredits).toLocaleString()}</td>
                  <td>{Math.round(month.totalCredits).toLocaleString()}</td>
                </tr>
                <tr>
                  <th>Total runs</th>
                  <td>{week.totalRuns}</td>
                  <td>{month.totalRuns}</td>
                </tr>
              </tbody>
            </Box>
          </AccordionDetails>
        </Accordion>
      </CardContent>
    </Card>
  );
}
