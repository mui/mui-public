import * as React from 'react';
import type { Metadata } from 'next';
import Reactions from '@/views/Reactions';

export const metadata: Metadata = { title: 'GitHub reactions' };

export default function ReactionsPage() {
  return <Reactions />;
}
