'use client';

import * as React from 'react';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HealthBadge from './HealthBadge';
import type { KpiConfig, KpiResult } from '../lib/kpis';

interface KpiCardProps {
  kpi: KpiConfig;
  result?: KpiResult;
  loading?: boolean;
}

export default function KpiCard({
  kpi,
  result,
  loading = false,
}: KpiCardProps): React.ReactElement {
  return (
    <React.Fragment>
      {loading ? (
        <Skeleton variant="text" width={150} height={32} />
      ) : (
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="h6" component="h3">
            {kpi.title}
          </Typography>
          {result?.error && (
            <Tooltip title={result.error}>
              <ErrorOutlineIcon color="error" fontSize="small" />
            </Tooltip>
          )}
        </Stack>
      )}
      {kpi.description && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {kpi.description}
        </Typography>
      )}
      <HealthBadge
        value={result?.value ?? null}
        warning={kpi.thresholds.warning}
        problem={kpi.thresholds.problem}
        unit={kpi.unit}
        lowerIsBetter={kpi.thresholds.lowerIsBetter}
        loading={loading}
        metadata={result?.metadata}
      />
    </React.Fragment>
  );
}
