import * as React from 'react';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import { createParseSource } from '@mui/internal-docs-infra/pipeline/parseSource';
import { CodeProvider } from '@mui/internal-docs-infra/CodeProvider';
import { CodeController } from '../code-editor/CodeController';
import { MultiFileContent } from './MultiFileContent';

const initialCode = {
  Default: {
    url: 'file:///App.tsx',
    fileName: 'App.tsx',
    source: `import React from 'react';

export default function App() {
  return (
    <div className="container">
      <h1>Multi-File Demo</h1>
      <p>Edit both the component and CSS!</p>
    </div>
  );
}`,
    extraFiles: {
      'styles.css': {
        source: `.container {
  padding: 20px;
  background: #f2eff3;
  border-radius: 8px;
}

h1 {
  color: #84828e;
  margin-bottom: 10px;
}

p {
  color: #65636d;
  font-size: 14px;
}`,
      },
    },
  },
};

export function MultiFileEditor() {
  return (
    <CodeProvider>
      <CodeController>
        <CodeHighlighter
          url={initialCode.Default.url}
          Content={MultiFileContent}
          code={initialCode}
          controlled
          sourceParser={createParseSource()}
        />
      </CodeController>
    </CodeProvider>
  );
}
