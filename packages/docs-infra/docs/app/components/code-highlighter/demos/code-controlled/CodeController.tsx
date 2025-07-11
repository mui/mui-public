'use client';

import * as React from 'react';
import type { Code } from '@mui/internal-docs-infra/CodeHighlighter';
import { CodeControllerContext } from '@mui/internal-docs-infra/CodeController';

export function CodeController({
  children,
  initialCode,
}: {
  children: React.ReactNode;
  initialCode?: Code;
}) {
  const [code, setCode] = React.useState(initialCode);
  const context = React.useMemo(() => ({ code, setCode }), [code, setCode]);

  return (
    <CodeControllerContext.Provider value={context}>{children}</CodeControllerContext.Provider>
  );
}
