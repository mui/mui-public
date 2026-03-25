import * as React from 'react';
import type { Metadata } from 'next';
import RepositoryBenchmarks from '@/views/RepositoryBenchmarks';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `Benchmarks - ${owner}/${repo}` };
}

export default function BenchmarksPage() {
  return <RepositoryBenchmarks />;
}
