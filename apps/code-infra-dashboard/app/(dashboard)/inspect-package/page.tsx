import * as React from 'react';
import type { Metadata } from 'next';
import InspectPackage from '@/views/InspectPackage';

export const metadata: Metadata = { title: 'npm package inspector' };

export default function InspectPackagePage() {
  return <InspectPackage />;
}
