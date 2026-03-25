import * as React from 'react';
import type { Metadata } from 'next';
import BenchmarkComparison from '@/views/BenchmarkComparison';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `Benchmark Comparison - ${owner}/${repo}` };
}

export default function BenchmarkComparisonPage() {
  return <BenchmarkComparison />;
}
