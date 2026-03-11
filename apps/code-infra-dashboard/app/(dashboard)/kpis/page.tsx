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

async function KpiCardAsync({ kpi }: { kpi: KpiConfig<any[]> }) {
  const result = await kpi.fetch(...(kpi.fetchParams ?? []));
  return <KpiCard kpi={kpi} result={result} />;
}

// Group KPIs by logical category
const kpisByGroup = kpiRegistry.reduce((acc, kpi) => {
  const group = acc.get(kpi.group) || [];
  group.push(kpi);
  acc.set(kpi.group, group);
  return acc;
}, new Map<string, KpiConfig<any[]>[]>());

export default function KpisPage() {
  return (
    <Box sx={{ mt: 4 }}>
      <Heading level={1}>KPIs Dashboard</Heading>

      {Array.from(kpisByGroup.entries()).map(([groupName, kpis]) => (
        <Box key={groupName} sx={{ mt: 4 }}>
          <Heading level={2}>{groupName}</Heading>
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
