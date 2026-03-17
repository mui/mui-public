'use client';

import * as React from 'react';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import HealthBadge from './HealthBadge';
import type { KpiConfig, KpiResult } from '../lib/kpis';

interface KpiCardProps {
  kpi: KpiConfig<any[]>;
  result?: KpiResult;
  loading?: boolean;
}

export default function KpiCard({
  kpi,
  result,
  loading = false,
}: KpiCardProps): React.ReactElement {
  const [copied, setCopied] = React.useState(false);

  const handleCopyEmbedLink = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const url = `${window.location.origin}/kpis/${kpi.id}/embed`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <React.Fragment>
      {loading ? (
        <Skeleton variant="text" width={150} height={32} />
      ) : (
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="h6" component="h3" sx={{ flex: 1 }}>
            {kpi.title}
          </Typography>
          {result?.error && (
            <Tooltip title={result.error}>
              <ErrorOutlineIcon color="error" fontSize="small" />
            </Tooltip>
          )}
          <Tooltip title={copied ? 'Copied!' : 'Copy embed link'}>
            <IconButton size="small" onClick={handleCopyEmbedLink}>
              {copied ? (
                <CheckIcon fontSize="small" color="success" />
              ) : (
                <ContentCopyIcon fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
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
