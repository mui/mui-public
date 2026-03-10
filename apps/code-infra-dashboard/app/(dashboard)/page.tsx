import * as React from 'react';
import type { Metadata } from 'next';
import Landing from '@/views/Landing';

export const metadata: Metadata = { title: 'Home' };

export default function HomePage() {
  return <Landing />;
}
