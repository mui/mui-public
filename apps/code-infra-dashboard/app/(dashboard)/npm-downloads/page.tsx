import * as React from 'react';
import type { Metadata } from 'next';
import NpmDownloads from '@/views/NpmDownloads';

export const metadata: Metadata = { title: 'npm downloads comparator' };

export default function NpmDownloadsPage() {
  return <NpmDownloads />;
}
