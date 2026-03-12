import * as React from 'react';
import { notFound } from 'next/navigation';
import { getKpiById, getAllKpiIds } from '@/lib/kpis';
import KpiCardEmbed from '@/components/KpiCardEmbed';

export async function generateStaticParams() {
  return getAllKpiIds().map((id) => ({ id }));
}

export const revalidate = 3600; // 1 hour ISR

interface PageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = 'force-static';

export default async function KpiEmbedPage({ params }: PageProps) {
  const { id } = await params;
  const kpi = getKpiById(id);

  if (!kpi) {
    notFound();
  }

  const result = await kpi.fetch(...(kpi.fetchParams ?? []));

  return <KpiCardEmbed kpi={kpi} result={result} />;
}

export async function generateMetadata({ params }: PageProps) {
  const { id } = await params;
  const kpi = getKpiById(id);
  return {
    title: kpi?.title ?? 'KPI',
    description: kpi?.description,
  };
}
