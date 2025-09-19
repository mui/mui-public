import 'server-only';

import * as React from 'react';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import { createParseSource } from '@mui/internal-docs-infra/pipeline/parseSource';

import { CodeContent } from '../CodeContent';
import { CodeContentLoading } from '../CodeContentLoading';

const sourceParser = createParseSource();

export function Code({ children, fileName }: { children: string; fileName?: string }) {
  return (
    <CodeHighlighter
      fileName={fileName}
      Content={CodeContent}
      ContentLoading={CodeContentLoading}
      sourceParser={sourceParser}
      fallbackUsesAllVariants
    >
      {children}
    </CodeHighlighter>
  );
}
