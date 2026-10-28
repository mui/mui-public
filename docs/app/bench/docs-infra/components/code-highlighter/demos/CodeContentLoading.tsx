'use client';

import * as React from 'react';
import type { ContentLoadingProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useCodeFallback } from '@mui/internal-docs-infra/CodeHighlighter';
import { hastToJsx } from '@mui/internal-docs-infra/pipeline/hastUtils';
import { generateFileSlug } from '@mui/internal-docs-infra/pipeline/loaderUtils';
import {
  CodeBlockHeader,
  CodeBlockHeaderLabel,
} from '../../../../../docs-infra/components/code-highlighter/demos/CodeBlockHeader';
import { CodeSource } from '../../../../../docs-infra/components/code-highlighter/demos/CodeSource';
import styles from './CodeContent.module.css';

export function CodeContentLoading(props: ContentLoadingProps<{}>) {
  // `useCodeFallback` renders the pre-hydration fallback source and hoists it
  // to `CodeHighlighterClient` (the DEFLATE dictionary for `hastCompressed`).
  const { source } = useCodeFallback(props);
  const fileName = props.fileNames?.[0];
  const mainSlug = props.slug ?? '';
  const mainVariant = props.initialVariant ?? 'Default';

  return (
    <div>
      {/* Per-file anchor targets so deep links keep resolving before the full
          CodeContent (which renders the same slugs) swaps in. */}
      {(props.fileNames ?? []).map((name) => {
        const slug = generateFileSlug(mainSlug, name, mainVariant);
        return <span key={slug} id={slug} className={styles.fileRefs} />;
      })}
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
        <CodeSource className={styles.code}>
          <pre className={styles.codeBlock}>
            {/* `data-filename` lets `transformHtmlCodeBlock` / crawlers read the
                file name; the source is the code element's text content. */}
            <code data-filename={fileName}>{source ? hastToJsx(source) : null}</code>
          </pre>
        </CodeSource>
      </div>
      {/* @focus-end */}
    </div>
  );
}
