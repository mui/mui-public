import * as React from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import Heading from '@/components/Heading';
import KpiCard from '@/components/KpiCard';
import LinkCardActionArea from '@/components/LinkCardActionArea';
import { kpiRegistry, type KpiConfig } from '@/lib/kpis';

export const revalidate = 3600; // 1 hour ISR

export const metadata = {
  title: 'KPIs Overview',
  description: 'Key Performance Indicators dashboard',
};

// Async component that fetches data for a single KPI
async function KpiCardAsync({ kpi }: { kpi: KpiConfig }) {
  const result = await kpi.fetch();
  return <KpiCard kpi={kpi} result={result} />;
}

// Group KPIs by data source for display
const kpisBySource = kpiRegistry.reduce((acc, kpi) => {
  const group = acc.get(kpi.dataSource) || [];
  group.push(kpi);
  acc.set(kpi.dataSource, group);
  return acc;
}, new Map<string, KpiConfig[]>());

const sourceLabels: Record<string, string> = {
  github: 'GitHub',
  zendesk: 'Zendesk',
  ossInsight: 'OSS Insight',
  circleCI: 'CircleCI',
  hibob: 'HiBob',
  store: 'Store',
};

export default function KpisPage() {
  return (
    <Box sx={{ mt: 4 }}>
      <Heading level={1}>KPIs Dashboard</Heading>

      {Array.from(kpisBySource.entries()).map(([source, kpis]) => (
        <Box key={source} sx={{ mt: 4 }}>
          <Heading level={2}>{sourceLabels[source] || source} KPIs</Heading>
          <Grid container spacing={3} sx={{ mt: 1 }}>
            {kpis.map((kpi) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={kpi.id}>
                <Card sx={{ height: '100%' }}>
                  <LinkCardActionArea href={`/kpis/${kpi.id}`}>
                    <CardContent sx={{ flexGrow: 1 }}>
                      <React.Suspense fallback={<KpiCard kpi={kpi} loading />}>
                        <KpiCardAsync kpi={kpi} />
                      </React.Suspense>
                    </CardContent>
                  </LinkCardActionArea>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Box>
      ))}
    </Box>
  );
}
