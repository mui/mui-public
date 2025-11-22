import 'server-only';

import * as React from 'react';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import { createParseSource } from '@mui/internal-docs-infra/pipeline/parseSource';

import { CodeContent } from '../CodeContent';

const sourceParser = createParseSource();

export function Code({ children, fileName }: { children: string; fileName?: string }) {
  return (
    <CodeHighlighter
      fileName={fileName}
      Content={CodeContent}
      sourceParser={sourceParser}
      highlightAfter="idle"
    >
      {children}
    </CodeHighlighter>
  );
}
