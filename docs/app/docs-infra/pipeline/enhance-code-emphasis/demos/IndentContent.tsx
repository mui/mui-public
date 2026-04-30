'use client';

import * as React from 'react';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useCode } from '@mui/internal-docs-infra/useCode';
import styles from './IndentContent.module.css';
import { useScrollAnchor } from './useScrollAnchor';

import '../../../components/code-highlighter/demos/syntax.css';

export function IndentContent(props: ContentProps<object>) {
  // @focus-start @padding 1
  const code = useCode(props, { preClassName: styles.codeBlock });
  const [expanded, setExpanded] = React.useState(false);
  const { containerRef, anchorScroll } = useScrollAnchor();

  return (
    <div ref={containerRef} className={styles.container}>
      <div className={`${styles.code} ${expanded ? styles.expanded : ''}`}>{code.selectedFile}</div>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => {
          anchorScroll(expanded ? 'collapse' : 'expand');
          setExpanded((prev) => !prev);
        }}
      >
        {expanded ? 'Collapse' : 'Expand'}
      </button>
    </div>
  );
  // @focus-end
}
