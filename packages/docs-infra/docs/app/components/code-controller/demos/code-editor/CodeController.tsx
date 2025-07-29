'use client';

import * as React from 'react';
import { CodeControllerContext } from '@mui/internal-docs-infra/CodeControllerContext';
import type { ControlledCode } from '@mui/internal-docs-infra/CodeHighlighter';

export function CodeController({ children }: { children: React.ReactNode }) {
  const [code, setCode] = React.useState<ControlledCode | undefined>(undefined);

  return (
    <CodeControllerContext.Provider value={{ code, setCode }}>
      {children}
    </CodeControllerContext.Provider>
  );
}
