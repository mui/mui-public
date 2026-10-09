import * as React from 'react';
import type { Metadata } from 'next';
import BenchmarkRunDetails from '@/views/BenchmarkRunDetails';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `Benchmark run - ${owner}/${repo}` };
}

export default function BenchmarkRunPage() {
  return <BenchmarkRunDetails />;
}
