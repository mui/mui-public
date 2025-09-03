import * as React from 'react';
import type { Metadata } from 'next';
import styles from '../layout.module.css';

export const metadata: Metadata = {
  title: 'MUI Infra Documentation',
  description: 'How to use the MUI Infra packages',
};

export default function Layout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className={styles.root}>
      <div className={styles.container}>{children}</div>
    </div>
  );
}
