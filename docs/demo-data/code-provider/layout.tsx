import * as React from 'react';
import { CodeProvider } from '@mui/internal-docs-infra/CodeProvider';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <CodeProvider>{children}</CodeProvider>;
}
