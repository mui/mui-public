import * as React from 'react';
import type { Metadata } from 'next';
import NpmVersions from '@/views/NpmVersions';

export const metadata: Metadata = { title: 'npm Versions' };

export default function NpmVersionsPage() {
  return <NpmVersions />;
}
