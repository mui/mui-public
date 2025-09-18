import * as React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '../layout.module.css';

export const metadata: Metadata = {
  title: 'MUI Docs Infra Documentation',
  description: 'How to use the MUI Docs-Infra package',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Link href="/docs-infra">MUI Docs Infra</Link>
      </div>
      <div className={styles.container}>{children}</div>
    </div>
  );
}
