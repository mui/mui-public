import * as React from 'react';
import type { Metadata } from 'next';
import RepositoryCharts from '@/views/RepositoryCharts';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `Bundle Size - ${owner}/${repo}` };
}

export default function BundleSizePage() {
  return <RepositoryCharts />;
}
