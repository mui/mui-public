import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import { parseSourceFactory } from '@mui/internal-docs-infra/parseSource';
import { TsToJsTransformer } from '@mui/internal-docs-infra/transformTsToJs';

import { CodeContent } from './CodeContent';

export function Code({ children, fileName }: { children: string; fileName?: string }) {
  return (
    <CodeHighlighter
      fileName={fileName}
      Content={CodeContent}
      sourceParser={parseSourceFactory()}
      sourceTransformers={[TsToJsTransformer]}
    >
      {children}
    </CodeHighlighter>
  );
}
