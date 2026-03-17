import * as React from 'react';
import { computeLevel, type HealthLevel } from '@/utils/kpi';
import type { KpiConfig, KpiResult } from '../lib/kpis';

import styles from './KpiCardEmbed.module.css';

const BADGE_COLORS: Record<HealthLevel, string> = {
  ok: 'var(--mui-palette-success-main)',
  warning: 'var(--mui-palette-warning-main)',
  problem: 'var(--mui-palette-error-main)',
  unknown: 'var(--mui-palette-action-disabled)',
};

const BADGE_LABELS: Record<HealthLevel, string> = {
  ok: 'Ok',
  warning: 'Warning',
  problem: 'Problem',
  unknown: 'Unknown',
};

interface KpiCardEmbed2Props {
  kpi: KpiConfig<any[]>;
  result?: KpiResult;
}

export default function KpiCardEmbed2({ kpi, result }: KpiCardEmbed2Props): React.ReactElement {
  const level = computeLevel(
    result?.value ?? null,
    kpi.thresholds.warning,
    kpi.thresholds.problem,
    !!kpi.thresholds.lowerIsBetter,
  );

  const formattedValue =
    result?.value === null || result?.value === undefined
      ? 'N/A'
      : `${result.value}${kpi.unit ? ` ${kpi.unit}` : ''}`;

  return (
    <div className={styles.root}>
      <div className={styles.row}>
        <h3 style={{ fontSize: '1.1em', fontWeight: 700, margin: 0 }}>{kpi.title}</h3>
        {result?.error && (
          <span style={{ color: 'var(--mui-palette-error-main)' }} title={result.error}>
            &#9888;
          </span>
        )}
      </div>

      {kpi.description && <div className={styles.description}>{kpi.description}</div>}

      <div className={styles.row}>
        <span className={styles.label}>Health:</span>
        <span className={styles.badge} style={{ background: BADGE_COLORS[level] }}>
          {BADGE_LABELS[level]}
        </span>
      </div>

      <div className={styles.row}>
        <span className={styles.label}>Value:</span>
        <span>{formattedValue}</span>
      </div>

      {result?.metadata && <div className={styles.metadata}>{result.metadata}</div>}
    </div>
  );
}
