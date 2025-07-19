import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import { parseSourceFactory } from '@mui/internal-docs-infra/parseSource';
import { CodeContent } from './CodeContent';
import { TsToJsTransformer } from '@mui/internal-docs-infra/transformTsToJs';

function Code({
  children,
  fileName = 'index.js',
  forceClient,
}: {
  children: string;
  fileName?: string;
  forceClient?: boolean;
}) {
  return (
    <CodeHighlighter
      url="file://index.js"
      code={{ Default: { url: 'file://index.js', fileName, source: children } }}
      Content={CodeContent}
      forceClient={forceClient}
      sourceParser={parseSourceFactory()}
      sourceTransformers={[TsToJsTransformer]}
    />
  );
}

export default Code;
