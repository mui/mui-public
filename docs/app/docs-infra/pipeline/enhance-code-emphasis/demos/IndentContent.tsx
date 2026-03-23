'use client';

import * as React from 'react';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useCode } from '@mui/internal-docs-infra/useCode';
import styles from './IndentContent.module.css';

import '@wooorm/starry-night/style/light';

export function IndentContent(props: ContentProps<object>) {
  const code = useCode(props, { preClassName: styles.codeBlock });
  const [expanded, setExpanded] = React.useState(false);

  return (
    <div className={styles.container}>
      <div className={`${styles.code} ${expanded ? styles.expanded : ''}`}>{code.selectedFile}</div>
      <button type="button" className={styles.toggle} onClick={() => setExpanded((prev) => !prev)}>
        {expanded ? 'Collapse' : 'Expand'}
      </button>
    </div>
  );
}
