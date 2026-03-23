import * as React from 'react';
import type { Metadata } from 'next';
import RepositoryPRs from '@/views/RepositoryPRs';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `PRs - ${owner}/${repo}` };
}

export default function PRsPage() {
  return <RepositoryPRs />;
}
