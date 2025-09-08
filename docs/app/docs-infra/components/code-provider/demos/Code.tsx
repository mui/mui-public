import * as React from 'react';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';

import { CodeContent } from '../../code-highlighter/demos/CodeContent';

export function Code({ children, fileName }: { children: string; fileName?: string }) {
  return (
    <CodeHighlighter fileName={fileName} Content={CodeContent}>
      {children}
    </CodeHighlighter>
  );
}
