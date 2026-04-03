import * as React from 'react';
import type { Metadata } from 'next';
import BenchmarkDetails from '@/views/BenchmarkDetails';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `Benchmark Details - ${owner}/${repo}` };
}

export default function BenchmarkDetailsPage() {
  return <BenchmarkDetails />;
}
