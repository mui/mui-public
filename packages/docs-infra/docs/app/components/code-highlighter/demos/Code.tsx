import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import { createParseSource } from '@mui/internal-docs-infra/parseSource';
import { TypescriptToJavascriptTransformer } from '@mui/internal-docs-infra/transformTypescriptToJavascript';

import { CodeContent } from './CodeContent';

export function Code({ children, fileName }: { children: string; fileName?: string }) {
  return (
    <CodeHighlighter
      fileName={fileName}
      Content={CodeContent}
      sourceParser={createParseSource()}
      sourceTransformers={[TypescriptToJavascriptTransformer]}
    >
      {children}
    </CodeHighlighter>
  );
}
