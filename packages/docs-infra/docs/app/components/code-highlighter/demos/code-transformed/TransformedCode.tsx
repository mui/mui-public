import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter';
import { hastOrJsonToJsx } from '@mui/internal-docs-infra/CodeHighlighter';

import '@wooorm/starry-night/style/both.css';

function CodeContent(props: ContentProps) {
  return (
    <div>
      <h2>{props.code.Default.fileName}</h2>
      <pre>{hastOrJsonToJsx(props.code.Default.source)}</pre>
    </div>
  );
}

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
    />
  );
}
