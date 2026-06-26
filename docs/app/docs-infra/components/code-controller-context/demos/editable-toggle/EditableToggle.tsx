import * as React from 'react';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import { createParseSource } from '@mui/internal-docs-infra/pipeline/parseSource';

import { CodeController } from './CodeController';
import { EditableToggleContent } from './EditableToggleContent';

const initialCode = {
  Default: {
    url: 'file://read-only-example.js',
    fileName: 'read-only-example.js',
    source: `// Read-only until you click Edit.
function greet(name) {
  return \`Hello, \${name}!\`;
}
`,
  },
};

export function EditableToggle() {
  return (
    // @focus-start
    // `initialDisabled` starts the block read-only; the Content's "Edit" button turns
    // editing on with the `setEditable` that `useCode` returns.
    <CodeController url={initialCode.Default.url}>
      <CodeHighlighter
        url={initialCode.Default.url}
        Content={EditableToggleContent}
        code={initialCode}
        controlled
        initialDisabled
        sourceParser={createParseSource()}
      />
    </CodeController>
    // @focus-end
  );
}
