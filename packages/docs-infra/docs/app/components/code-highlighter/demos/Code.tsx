import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import { parseSourceFactory } from '@mui/internal-docs-infra/parseSource';
import { TsToJsTransformer } from '@mui/internal-docs-infra/transformTsToJs';

import { CodeContent } from './CodeContent';

export function Code({ children, fileName = 'index.js' }: { children: string; fileName?: string }) {
  return (
    <CodeHighlighter
      url="file://index.js"
      code={{ Default: { url: 'file://index.js', fileName, source: children } }}
      Content={CodeContent}
      sourceParser={parseSourceFactory()}
      sourceTransformers={[TsToJsTransformer]}
    />
  );
}
