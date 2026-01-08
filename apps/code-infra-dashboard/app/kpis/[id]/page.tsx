import * as React from 'react';
import { notFound } from 'next/navigation';
import Box from '@mui/material/Box';
import { getKpiById, getAllKpiIds } from '@/lib/kpis';
import KpiDetail from '@/views/KpiDetail';

export async function generateStaticParams() {
  return getAllKpiIds().map((id) => ({ id }));
}

export const revalidate = 3600; // 1 hour ISR

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function KpiPage({ params }: PageProps) {
  const { id } = await params;
  const kpi = getKpiById(id);

  if (!kpi) {
    notFound();
  }

  const result = await kpi.fetch();

  return (
    <Box sx={{ p: 2 }}>
      <KpiDetail kpi={kpi} result={result} />
    </Box>
  );
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const kpi = getKpiById(id);
  return {
    title: kpi?.title ?? 'KPI',
    description: kpi?.description,
  };
}
