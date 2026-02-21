import * as React from 'react';
import type { Metadata } from 'next';
import InspectPackage from '@/views/InspectPackage';

export const metadata: Metadata = { title: 'Inspect Package' };

export default function InspectPackagePage() {
  return <InspectPackage />;
}
