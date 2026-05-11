import * as React from 'react';
import type { Metadata } from 'next';
import { Roboto } from 'next/font/google';
import InitColorSchemeScript from '@mui/material/InitColorSchemeScript';
import Providers from './Providers';
import '../src/index.css';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: {
    template: '%s | Code Infra',
    default: 'Code Infra',
  },
};

const roboto = Roboto({
  weight: ['300', '400', '500', '700'],
  subsets: ['latin'],
  display: 'swap',
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={roboto.className} suppressHydrationWarning>
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body>
        <InitColorSchemeScript attribute="data" />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
