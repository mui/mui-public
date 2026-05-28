'use client';

import * as React from 'react';
import KpiCard from '../components/KpiCard';
import type { KpiInfo, KpiResult } from '../lib/kpis';

interface KpiDetailProps {
  kpi: KpiInfo;
  result: KpiResult;
}

export default function KpiDetail({ kpi, result }: KpiDetailProps): React.ReactElement {
  return <KpiCard kpi={kpi} result={result} />;
}
