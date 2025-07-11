import * as React from 'react';
import { HighlightProvider } from '../../../../../../build/esm/CodeProvider';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import { CodeController } from './CodeController';
import { EditableCode } from './EditableCode';

export default function ControlledCode() {
  const initialCode = {
    Default: {
      fileName: 'index.ts',
      source: `console.log('Hello, world!');`,
    },
  };

  return (
    <HighlightProvider>
      <CodeController initialCode={initialCode}>
        <CodeHighlighter controlled code={initialCode} Content={EditableCode} />
      </CodeController>
    </HighlightProvider>
  );
}
