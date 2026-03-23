import * as React from 'react';
import type { Metadata } from 'next';
import CiAnalytics from '@/views/CiAnalytics';

export const metadata: Metadata = { title: 'CI Analytics' };

export default function CiAnalyticsPage() {
  return <CiAnalytics />;
}
