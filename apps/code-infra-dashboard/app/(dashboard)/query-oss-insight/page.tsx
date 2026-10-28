import * as React from 'react';
import type { Metadata } from 'next';
import QueryOssInsight from '@/views/QueryOssInsight';

export const metadata: Metadata = { title: 'Query OSS Insight' };

export default function QueryOssInsightPage() {
  return <QueryOssInsight />;
}
