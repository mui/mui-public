import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import { parseSource } from '@mui/internal-docs-infra/parseSource';
import { CodeContent } from './CodeContent';
import { transformTsToJs } from '@mui/internal-docs-infra/transformTsToJs';

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
      code={{ Default: { fileName, source: children } }}
      Content={CodeContent}
      forceClient={forceClient}
      parseSource={parseSource}
      sourceTransformers={[{ extensions: ['ts', 'tsx'], transformer: transformTsToJs }]}
    />
  );
}

export default Code;
