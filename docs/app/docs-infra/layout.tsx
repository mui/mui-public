import * as React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Navigation } from '@/components/Navigation';
import styles from '../layout.module.css';
import { sitemap } from '../sitemap';
import { Search } from '../search';

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
        <div className={styles.headerContainer}>
          <Link href="/docs-infra">MUI Docs Infra</Link>
          <Search enableKeyboardShortcut containedScroll />
        </div>
      </div>
      <div className={styles.contentWrapper}>
        <Navigation sitemap={sitemap} />
        <div className={styles.container}>{children}</div>
      </div>
    </div>
  );
}
