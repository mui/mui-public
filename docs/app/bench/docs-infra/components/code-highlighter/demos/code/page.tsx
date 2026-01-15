import * as React from 'react';
import { createParseSource } from '@mui/internal-docs-infra/pipeline/parseSource';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';

import { CodeContent } from '../CodeContent';
import { CodeContentLoading } from '../CodeContentLoading';

import code from '../../snippets/large/snippet';

const sourceParser = createParseSource();

export default function Page() {
  return (
    <CodeHighlighter
      Content={CodeContent}
      ContentLoading={CodeContentLoading}
      sourceParser={sourceParser}
      fileName="large-file.js"
    >
      {code}
    </CodeHighlighter>
  );
}
