import * as React from 'react';
import { Box, Typography, Stack, Skeleton } from '@mui/material';
import { createComponent } from '@mui/toolpad/browser';

export interface HeathBadgeProps {
  level: string;
}

const levelsInfo = {
  ok: {
    label: 'Ok',
    backgroundColor: 'green',
  },
  warning: {
    label: 'Warning',
    backgroundColor: 'orange',
  },
  problem: {
    label: 'Problem',
    backgroundColor: 'red',
  },
  unknown: {
    label: 'Unknown',
    backgroundColor: 'grey',
  },
};

// Using this style https://about.gitlab.com/handbook/marketing/performance-indicators/#legends
function HeathBadge({ level }: HeathBadgeProps) {
  const info = levelsInfo[level];
  return (
    <Box
      sx={{
        backgroundColor: info.backgroundColor,
        color: 'white',
        borderRadius: '0.2em',
        fontWeight: 700,
        fontSize: 14,
        display: 'flex',
        alignItems: 'center',
        padding: '2px 12px',
        textAlign: 'center',
      }}
    >
      {info.label}
    </Box>
  );
}

interface ReportProps {
  value: number;
  warning: number;
  problem: number;
  unit: string;
  lowerIsBetter: boolean;
  loading?: boolean;
}

function Report(props: ReportProps) {
  let level = 'unknown';
  let { value, warning, problem, unit, lowerIsBetter, loading } = props;

  if (!loading) {
    if (lowerIsBetter) {
      if (value > problem) {
        level = 'problem';
      } else if (value > warning) {
        level = 'warning';
      } else if (value != null) {
        level = 'ok';
      }
    } else {
      if (value < problem) {
        level = 'problem';
      } else if (value < warning) {
        level = 'warning';
      } else if (value != null) {
        level = 'ok';
      }
    }
  }

  return (
    <Stack spacing={0.5}>
      <Stack direction="row" spacing={1}>
        <Typography sx={{ width: 100 }}>Health:</Typography>
        <HeathBadge level={level} />
      </Stack>
      <Stack direction="row" spacing={1}>
        <Typography sx={{ width: 100 }}>Value:</Typography>
        <Typography sx={{ flex: 1 }}>
          {loading ? <Skeleton variant="text" /> : `${value} ${unit}`}
        </Typography>
      </Stack>
    </Stack>
  );
}

export default createComponent(Report, {
  loadingProp: 'loading',
  loadingPropSource: ['value'],
  argTypes: {
    value: {
      type: 'number',
      default: undefined,
    },
    warning: {
      type: 'number',
      default: 1,
    },
    problem: {
      type: 'number',
      default: 1,
    },
    unit: {
      type: 'string',
      default: '%',
    },
    lowerIsBetter: {
      type: 'boolean',
      default: false,
    },
  },
});
