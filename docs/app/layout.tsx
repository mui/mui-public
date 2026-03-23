import * as React from 'react';
import type { Metadata } from 'next';
import { Google_Sans, JetBrains_Mono } from 'next/font/google';
import styles from './layout.module.css';
import './global.css';

const googleSans = Google_Sans({
  variable: '--font-text',
  subsets: ['latin'],
  axes: ['opsz', 'GRAD'],
  fallback: ['Arial', 'sans-serif'],
});

const jetBrainsMono = JetBrains_Mono({
  variable: '--font-code',
  subsets: ['latin'],
  weight: ['400'],
  style: ['normal'],
  fallback: ["'Courier New'", 'Courier', 'monospace'],
});

const fontClassNames = [googleSans.variable, jetBrainsMono.variable].join(' ');

export const metadata: Metadata = {
  title: 'MUI Infra Documentation',
  description: 'How to use the MUI Infra packages',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${fontClassNames} ${styles.body}`}>
        <div>{children}</div>
      </body>
    </html>
  );
}
