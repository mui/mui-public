import * as React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { TypesDataProvider } from '@mui/internal-docs-infra/useType';
import { Navigation } from '@/components/Navigation';
import styles from '../layout.module.css';
import { sitemap } from '../sitemap';
import { Search } from '../search';
import Notice from '../notice.mdx';

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
    <TypesDataProvider>
      <div className={styles.root}>
        <div className={styles.header}>
          <div className={styles.headerContainer}>
            <Link href="/docs-infra">MUI Docs Infra</Link>
            <Search enableKeyboardShortcut containedScroll />
          </div>
        </div>
        <div className={styles.contentWrapper}>
          <Navigation sitemap={sitemap} />
          <div className={styles.container}>
            <div className={styles.notice}>
              <Notice />
            </div>
            <div className={styles.content}>{children}</div>
          </div>
        </div>
      </div>
    </TypesDataProvider>
  );
}
