import * as React from 'react';
import type { Metadata } from 'next';
import MuiAbout from '@/views/MuiAbout';

export const metadata: Metadata = { title: 'mui.com/about' };

export default function MuiAboutPage() {
  return <MuiAbout />;
}
