import * as React from 'react';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import { createParseSource } from '@mui/internal-docs-infra/pipeline/parseSource';

import { CredentialsCodeContent } from './CredentialsCodeContent';
import { AddApiKeyTransformer } from './addApiKeyTransformer';

const sourceParser = createParseSource();
const sourceTransformers = [AddApiKeyTransformer];

export function Code({ children, fileName }: { children: string; fileName?: string }) {
  return (
    // @focus-start
    <CodeHighlighter
      fileName={fileName}
      Content={CredentialsCodeContent}
      sourceParser={sourceParser}
      sourceTransformers={sourceTransformers}
    >
      {children}
    </CodeHighlighter>
    // @focus-end
  );
}
