'use client';

import * as React from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import Tooltip from '@mui/material/Tooltip';
import type { WorkflowMetrics, PeriodSummary } from '../lib/ciAnalytics';
import { formatDuration, formatSuccessRate } from '../lib/ciAnalytics';

const WEEK_DAYS = 7;
const MONTH_DAYS = 30;
const THRESHOLD_PCT = 5;
const LOW_SUCCESS_RATE = 0.85;

type MetricSeverity = 'error' | 'warning' | null;

export interface WorkflowAnalysis {
  severity: MetricSeverity;

  successRate: number;
  successSeverity: MetricSeverity;
  successDelta: number;
  successDeltaSeverity: MetricSeverity;

  runtimeSecs: number;
  runtimeDelta: number;
  runtimeDeltaSeverity: MetricSeverity;

  creditsPerDay: number | null;
  creditsDelta: number | null;
  creditsDeltaSeverity: MetricSeverity;
}

function formatDelta(delta: number): string {
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}%`;
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
  }

  return { successDelta, runtimeDelta, creditsDelta, weekCreditsPerDay };
}

export function computeWorkflowAnalysis(wf: WorkflowMetrics): WorkflowAnalysis {
  const { successDelta, runtimeDelta, creditsDelta, weekCreditsPerDay } = computeDeltas(
    wf.week,
    wf.month,
    wf.allBranchCredits,
  );

  const successSeverity: MetricSeverity = wf.week.successRate < LOW_SUCCESS_RATE ? 'error' : null;
  const successDeltaSeverity: MetricSeverity = successDelta < -THRESHOLD_PCT ? 'error' : null;
  const runtimeDeltaSeverity: MetricSeverity = runtimeDelta > THRESHOLD_PCT ? 'warning' : null;
  const creditsDeltaSeverity: MetricSeverity =
    creditsDelta != null && creditsDelta > THRESHOLD_PCT ? 'warning' : null;

  let severity: MetricSeverity = null;
  if (successSeverity === 'error' || successDeltaSeverity === 'error') {
    severity = 'error';
  } else if (runtimeDeltaSeverity === 'warning' || creditsDeltaSeverity === 'warning') {
    severity = 'warning';
  }

  return {
    severity,
    successRate: wf.week.successRate,
    successSeverity,
    successDelta,
    successDeltaSeverity,
    runtimeSecs: wf.week.avgSuccessDurationSecs,
    runtimeDelta,
    runtimeDeltaSeverity,
    creditsPerDay: weekCreditsPerDay,
    creditsDelta,
    creditsDeltaSeverity,
  };
}

function MetricRow({
  label,
  value,
  valueSeverity,
  valueTooltip,
  delta,
  deltaSeverity,
  invert,
}: {
  label: string;
  value: React.ReactNode;
  valueSeverity: MetricSeverity;
  valueTooltip: string;
  delta: number;
  deltaSeverity: MetricSeverity;
  invert?: boolean;
}) {
  const valueColor = valueSeverity ? `${valueSeverity}.main` : undefined;

  let deltaColor: string;
  let deltaTooltip: string;
  if (valueSeverity) {
    deltaColor = 'text.secondary';
    deltaTooltip = `${formatDelta(delta)} vs 30d`;
  } else if (deltaSeverity) {
    const direction = invert ? 'increase' : 'decrease';
    deltaColor = `${deltaSeverity}.main`;
    deltaTooltip = `${formatDelta(delta)} vs 30d — ${direction} exceeds ${THRESHOLD_PCT}% threshold`;
  } else if (Math.abs(delta) >= THRESHOLD_PCT) {
    deltaColor = 'text.primary';
    deltaTooltip = `${formatDelta(delta)} vs 30d — improved`;
  } else {
    const isGood = invert ? delta < 0 : delta > 0;
    deltaColor = 'text.secondary';
    deltaTooltip = `${formatDelta(delta)} vs 30d${isGood ? ' — improved' : ''}`;
  }

  const valueEl = (
    <Tooltip disableInteractive title={valueTooltip}>
      <Typography variant="body1" sx={{ fontWeight: 'bold', color: valueColor }}>
        {value}
      </Typography>
    </Tooltip>
  );
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 100 }}>
        {label}
      </Typography>
      {valueEl}
      <Tooltip disableInteractive title={deltaTooltip}>
        <Typography component="span" variant="body2" sx={{ color: deltaColor }}>
          {formatDelta(delta)}
        </Typography>
      </Tooltip>
      <Typography component="span" variant="body2" color="text.secondary">
        vs. 30d
      </Typography>
    </Box>
  );
}

interface CiWorkflowCardProps {
  slug: string;
  workflow: WorkflowMetrics;
}

export default function CiWorkflowCard({ slug, workflow }: CiWorkflowCardProps) {
  const analysis = computeWorkflowAnalysis(workflow);
  const { week, month } = workflow;

  return (
    <Card
      variant="outlined"
      sx={{
        borderColor: analysis.severity ? `${analysis.severity}.main` : 'success.main',
        bgcolor: analysis.severity ? `${analysis.severity}.50` : undefined,
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
            value={formatSuccessRate(analysis.successRate)}
            valueSeverity={analysis.successSeverity}
            valueTooltip={
              analysis.successSeverity
                ? `Success rate ${formatSuccessRate(analysis.successRate)} is below ${LOW_SUCCESS_RATE * 100}%`
                : `Success rate: ${formatSuccessRate(analysis.successRate)}`
            }
            delta={analysis.successDelta}
            deltaSeverity={analysis.successDeltaSeverity}
          />
          <MetricRow
            label="Runtime"
            value={formatDuration(analysis.runtimeSecs)}
            valueSeverity={null}
            valueTooltip={`Runtime: ${formatDuration(analysis.runtimeSecs)}`}
            delta={analysis.runtimeDelta}
            deltaSeverity={analysis.runtimeDeltaSeverity}
            invert
          />
          {analysis.creditsDelta != null && analysis.creditsPerDay != null ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <MetricRow
                label="Credits/day"
                value={Math.round(analysis.creditsPerDay).toLocaleString()}
                valueSeverity={null}
                valueTooltip={`Credits/day: ${Math.round(analysis.creditsPerDay).toLocaleString()}`}
                delta={analysis.creditsDelta}
                deltaSeverity={analysis.creditsDeltaSeverity}
                invert
              />
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
