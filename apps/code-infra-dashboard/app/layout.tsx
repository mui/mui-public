import * as React from 'react';
import { Roboto } from 'next/font/google';
import Providers from './Providers';
import '../src/index.css';

const roboto = Roboto({
  weight: ['300', '400', '500', '700'],
  subsets: ['latin'],
  display: 'swap',
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={roboto.className}>
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Code infra dashboard</title>
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
