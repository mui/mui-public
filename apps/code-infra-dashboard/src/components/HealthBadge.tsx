import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Skeleton from '@mui/material/Skeleton';

type HealthLevel = 'ok' | 'warning' | 'problem' | 'unknown';

const levelsInfo: Record<HealthLevel, { label: string; backgroundColor: string }> = {
  ok: { label: 'Ok', backgroundColor: 'green' },
  warning: { label: 'Warning', backgroundColor: 'orange' },
  problem: { label: 'Problem', backgroundColor: 'red' },
  unknown: { label: 'Unknown', backgroundColor: 'grey' },
};

interface HealthBadgeLabelProps {
  level: HealthLevel;
}

function HealthBadgeLabel({ level }: HealthBadgeLabelProps): React.ReactElement {
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

function computeLevel(
  value: number | null,
  warning: number,
  problem: number,
  lowerIsBetter: boolean,
): HealthLevel {
  if (value == null) {
    return 'unknown';
  }

  if (lowerIsBetter) {
    if (value > problem) {
      return 'problem';
    }
    if (value > warning) {
      return 'warning';
    }
    return 'ok';
  }
  if (value < problem) {
    return 'problem';
  }
  if (value < warning) {
    return 'warning';
  }
  return 'ok';
}

export interface HealthBadgeProps {
  value: number | null;
  warning: number;
  problem: number;
  unit: string;
  lowerIsBetter?: boolean;
  loading?: boolean;
  metadata?: string;
}

export default function HealthBadge({
  value,
  warning,
  problem,
  unit,
  lowerIsBetter = false,
  loading = false,
  metadata,
}: HealthBadgeProps): React.ReactElement {
  const level = loading ? 'unknown' : computeLevel(value, warning, problem, lowerIsBetter);

  return (
    <Stack spacing={0.5}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography sx={{ width: 100 }}>Health:</Typography>
        {loading ? (
          <Skeleton variant="rounded" width={80} height={24} />
        ) : (
          <HealthBadgeLabel level={level} />
        )}
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography sx={{ width: 100 }}>Value:</Typography>
        <Typography sx={{ flex: 1 }}>
          {loading ? <Skeleton variant="text" width={100} /> : `${value ?? 'N/A'}${unit}`}
        </Typography>
      </Stack>
      {metadata && (
        <Typography variant="body2" color="text.secondary">
          {metadata}
        </Typography>
      )}
    </Stack>
  );
}
