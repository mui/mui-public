import * as React from 'react';
import { createParseSource } from '@mui/internal-docs-infra/pipeline/parseSource';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import { CodeProvider } from '@mui/internal-docs-infra/CodeProvider';
import { CodeController } from '../../../../../../docs-infra/components/code-controller-context/demos/code-editor/CodeController';
import { CodeEditorContent } from '../../../../../../docs-infra/components/code-controller-context/demos/code-editor/CodeEditorContent';

import code from '../../../code-highlighter/snippets/large/snippet';

const sourceParser = createParseSource();

export default function Page() {
  return (
    <CodeProvider>
      <CodeController>
        <CodeHighlighter
          Content={CodeEditorContent}
          controlled
          sourceParser={sourceParser}
          fileName="large-file.js"
        >
          {code}
        </CodeHighlighter>
      </CodeController>
    </CodeProvider>
  );
}
