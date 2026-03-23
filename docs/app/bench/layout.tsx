import * as React from 'react';
import type { Metadata } from 'next';

import { BenchProvider } from '@/components/BenchProvider';
import styles from '../layout.module.css';

export const metadata: Metadata = {
  title: 'MUI Infra Benchmarks',
  description: 'Performance demos for MUI Infra packages',
  robots: { index: false, follow: false },
};

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className={styles.root}>
      <div className={styles.container}>
        <BenchProvider>{children}</BenchProvider>
      </div>
    </div>
  );
}
