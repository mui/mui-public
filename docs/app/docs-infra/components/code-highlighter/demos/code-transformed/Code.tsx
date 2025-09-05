import * as React from 'react';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import { createParseSource } from '@mui/internal-docs-infra/pipeline/parseSource';
import { TypescriptToJavascriptTransformer } from '@mui/internal-docs-infra/pipeline/transformTypescriptToJavascript';

import { CodeContent } from '../CodeContent';

const sourceParser = createParseSource();
const sourceTransformers = [TypescriptToJavascriptTransformer];

export function Code({ children, fileName }: { children: string; fileName?: string }) {
  return (
    <CodeHighlighter
      fileName={fileName}
      Content={CodeContent}
      sourceParser={sourceParser}
      sourceTransformers={sourceTransformers}
    >
      {children}
    </CodeHighlighter>
  );
}
