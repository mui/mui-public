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

const THRESHOLD_PCT = 5;
const HIGH_RUNTIME_DELTA = 20;
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

  creditsPerRun: number;
  creditsPerRunDelta: number;
  creditsPerRunDeltaSeverity: MetricSeverity;
}

function formatDelta(delta: number): string {
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}%`;
}

/**
 * Rates and averages of a period without runs don't exist, so show a dash instead of the stored 0.
 */
function ifRuns(period: PeriodSummary, value: string): string {
  return period.totalRuns > 0 ? value : '—';
}

function getCircleCiInsightsUrl(slug: string, workflow: string): string {
  // slug is e.g. "gh/mui/mui-x" → extract "mui/mui-x"
  const orgRepo = slug.replace(/^gh\//, '');
  return `https://app.circleci.com/insights/github/${orgRepo}/workflows/${workflow}/overview?branch=master`;
}

function computeDeltas(week: PeriodSummary, month: PeriodSummary) {
  const weekSuccessPct = week.successRate * 100;
  const monthSuccessPct = month.successRate * 100;
  const successDelta = weekSuccessPct - monthSuccessPct;

  // Callers guarantee `week.totalRuns > 0`, and week runs are a subset of month runs.
  const weekCreditsPerRun = week.totalCredits / week.totalRuns;
  const monthCreditsPerRun = month.totalCredits / month.totalRuns;
  const creditsPerRunDelta =
    monthCreditsPerRun > 0
      ? ((weekCreditsPerRun - monthCreditsPerRun) / monthCreditsPerRun) * 100
      : 0;

  let runtimeDelta = 0;
  if (month.avgSuccessDurationSecs > 0) {
    runtimeDelta =
      ((week.avgSuccessDurationSecs - month.avgSuccessDurationSecs) /
        month.avgSuccessDurationSecs) *
      100;
  }

  return { successDelta, runtimeDelta, creditsPerRunDelta, weekCreditsPerRun };
}

/**
 * Returns `null` when the workflow had no runs in the last 7 days: rates and averages of an empty
 * period are not zero, they don't exist.
 */
export function computeWorkflowAnalysis(wf: WorkflowMetrics): WorkflowAnalysis | null {
  if (wf.week.totalRuns === 0) {
    return null;
  }

  const { successDelta, runtimeDelta, creditsPerRunDelta, weekCreditsPerRun } = computeDeltas(
    wf.week,
    wf.month,
  );

  const successSeverity: MetricSeverity = wf.week.successRate < LOW_SUCCESS_RATE ? 'error' : null;
  const successDeltaSeverity: MetricSeverity = successDelta < -THRESHOLD_PCT ? 'error' : null;
  let runtimeDeltaSeverity: MetricSeverity = null;
  if (runtimeDelta > HIGH_RUNTIME_DELTA) {
    runtimeDeltaSeverity = 'error';
  } else if (runtimeDelta > THRESHOLD_PCT) {
    runtimeDeltaSeverity = 'warning';
  }
  const creditsPerRunDeltaSeverity: MetricSeverity =
    creditsPerRunDelta > THRESHOLD_PCT ? 'warning' : null;

  let severity: MetricSeverity = null;
  if (
    successSeverity === 'error' ||
    successDeltaSeverity === 'error' ||
    runtimeDeltaSeverity === 'error'
  ) {
    severity = 'error';
  } else if (runtimeDeltaSeverity === 'warning' || creditsPerRunDeltaSeverity === 'warning') {
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
    creditsPerRun: weekCreditsPerRun,
    creditsPerRunDelta,
    creditsPerRunDeltaSeverity,
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
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderColor: analysis?.severity ? `${analysis.severity}.main` : 'success.main',
        bgcolor: analysis?.severity ? `${analysis.severity}.50` : undefined,
      }}
    >
      <CardContent sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        <Link
          href={getCircleCiInsightsUrl(slug, workflow.name)}
          target="_blank"
          underline="hover"
          variant="h6"
          sx={{ display: 'block', mb: 2 }}
        >
          {slug} / {workflow.name}
        </Link>

        {analysis ? (
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
            <MetricRow
              label="Credits/run"
              value={Math.round(analysis.creditsPerRun).toLocaleString()}
              valueSeverity={null}
              valueTooltip={`Credits/run (master): ${Math.round(analysis.creditsPerRun).toLocaleString()}`}
              delta={analysis.creditsPerRunDelta}
              deltaSeverity={analysis.creditsPerRunDeltaSeverity}
              invert
            />
          </Box>
        ) : (
          <Typography variant="body2" color="text.disabled" sx={{ fontStyle: 'italic' }}>
            No runs on master in the last 7 days
          </Typography>
        )}

        <Accordion
          disableGutters
          elevation={0}
          sx={{
            mt: 'auto',
            '&::before': { display: 'none' },
            backgroundColor: 'transparent',
          }}
        >
          <AccordionSummary
            expandIcon={<ExpandMoreIcon sx={{ fontSize: '0.8rem', color: 'primary.main' }} />}
            sx={{
              minHeight: 0,
              p: 0,
              gap: 0.5,
              '& .MuiAccordionSummary-content': { m: 0, flexGrow: 0 },
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
                  <td>{ifRuns(week, formatSuccessRate(week.successRate))}</td>
                  <td>{ifRuns(month, formatSuccessRate(month.successRate))}</td>
                </tr>
                <tr>
                  <th>Avg runtime</th>
                  <td>{ifRuns(week, formatDuration(week.avgDurationSecs))}</td>
                  <td>{ifRuns(month, formatDuration(month.avgDurationSecs))}</td>
                </tr>
                <tr>
                  <th>Avg success runtime</th>
                  <td>{ifRuns(week, formatDuration(week.avgSuccessDurationSecs))}</td>
                  <td>{ifRuns(month, formatDuration(month.avgSuccessDurationSecs))}</td>
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
