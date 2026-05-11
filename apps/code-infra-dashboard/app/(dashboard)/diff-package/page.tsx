import * as React from 'react';
import type { Metadata } from 'next';
import DiffPackage from '@/views/DiffPackage';

export const metadata: Metadata = { title: 'npm package diff tool' };

export default function DiffPackagePage() {
  return <DiffPackage />;
}
