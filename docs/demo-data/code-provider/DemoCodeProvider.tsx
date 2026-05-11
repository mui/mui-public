import * as React from 'react';
import Layout from './layout';

export default function DemoCodeProvider({ children }: { children: React.ReactNode }) {
  return <Layout>{children}</Layout>;
}
