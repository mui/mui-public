import * as React from 'react';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import { parseSourceFactory } from '@mui/internal-docs-infra/parseSource';

import { CodeController } from './CodeController';
import { CodeEditorContent } from './CodeEditorContent';
import { CodeProvider } from '@mui/internal-docs-infra/CodeProvider';

const initialCode = {
  Default: {
    url: 'file://live-example.js',
    fileName: 'live-example.js',
    source: `// Welcome to the live code editor!
function greet(name) {
  return \`Hello, \${name}!\`;
}
`,
  },
};

export function CodeEditor() {
  return (
    <CodeProvider>
      <CodeController>
        <CodeHighlighter
          url={initialCode.Default.url}
          Content={CodeEditorContent}
          code={initialCode}
          controlled
          sourceParser={parseSourceFactory()}
        />
      </CodeController>
    </CodeProvider>
  );
}
