import * as React from 'react';
import type { Metadata } from 'next';
import SizeComparison from '@/views/SizeComparison';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `Size Comparison - ${owner}/${repo}` };
}

export default function SizeComparisonPage() {
  return <SizeComparison />;
}
