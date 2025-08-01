import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import styles from './layout.module.css';
import Link from 'next/link';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

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
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} ${styles.body}`}>
        <div className={styles.header}>
          <Link href="/">MUI Docs Infra</Link>
        </div>
        <div className={styles.container}>{children}</div>
      </body>
    </html>
  );
}
