import * as React from 'react';
import type { Metadata } from 'next';
import TachometerDetails from '@/views/TachometerDetails';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `Tachometer Details - ${owner}/${repo}` };
}

export default function TachometerDetailsPage() {
  return <TachometerDetails />;
}
