'use client';

import * as React from 'react';
import type { ContentLoadingProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useCodeFallback } from '@mui/internal-docs-infra/CodeHighlighter';
import { hastToJsx } from '@mui/internal-docs-infra/pipeline/hastUtils';
import {
  CodeBlockHeader,
  CodeBlockHeaderLabel,
} from '../../../../../docs-infra/components/code-highlighter/demos/CodeBlockHeader';
import styles from './CodeContent.module.css';

import '../../../../../docs-infra/components/code-highlighter/demos/syntax.css';

export function CodeContentLoading(props: ContentLoadingProps<{}>) {
  // `useCodeFallback` renders the pre-hydration fallback source and hoists it
  // to `CodeHighlighterClient` (the DEFLATE dictionary for `hastCompressed`).
  const { source } = useCodeFallback(props);
  const fileName = props.fileNames?.[0];

  return (
    <div>
      {/* @focus-start */}
      {/*
        Mirror CodeContent's container + header + code so the fallback matches
        its chrome and the code sits at its final position. The header shows the
        filename (like CodeContent) but omits the actions menu; its fixed 48px
        height means swapping to the full CodeContent doesn't shift the code.
      */}
      <div className={styles.container}>
        <CodeBlockHeader roundedTop>
          {fileName ? <CodeBlockHeaderLabel>{fileName}</CodeBlockHeaderLabel> : null}
        </CodeBlockHeader>
        <div className={styles.code}>
          <pre className={styles.codeBlock}>
            <code>{source ? hastToJsx(source) : null}</code>
          </pre>
        </div>
      </div>
      {/* @focus-end */}
    </div>
  );
}
