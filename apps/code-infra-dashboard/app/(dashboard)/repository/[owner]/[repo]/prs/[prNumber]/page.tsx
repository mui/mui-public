import * as React from 'react';
import type { Metadata } from 'next';
import RepositoryPR from '@/views/RepositoryPR';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string; repo: string; prNumber: string }>;
}): Promise<Metadata> {
  const { owner, repo, prNumber } = await params;
  return { title: `PR #${prNumber} - ${owner}/${repo}` };
}

export default function PRPage() {
  return <RepositoryPR />;
}
