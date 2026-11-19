import * as React from 'react';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import { createParseSource } from '@mui/internal-docs-infra/pipeline/parseSource';
import '@mui/internal-docs-infra/syntaxTheme.css';
import { PreviewContent } from './PreviewContent';
import styles from './SyntaxThemePreview.module.css';

const sourceParser = createParseSource();

const source = `import * as React from 'react';

type Props = { label: string; count?: number };

// Renders a labelled counter
export function Counter({ label, count = 0 }: Props) {
  const text = \`\${label}: \${count}\`;
  return <span data-count={count}>{text}</span>;
}`;

export function SyntaxThemePreview() {
  return (
    <div className={styles.grid}>
      {(['light', 'dark'] as const).map((scheme) => (
        // @focus-start
        <div key={scheme} className={styles[scheme]} data-color-scheme={scheme}>
          <CodeHighlighter
            fileName="Counter.tsx"
            Content={PreviewContent}
            sourceParser={sourceParser}
          >
            {source}
          </CodeHighlighter>
        </div>
        // @focus-end
      ))}
    </div>
  );
}
