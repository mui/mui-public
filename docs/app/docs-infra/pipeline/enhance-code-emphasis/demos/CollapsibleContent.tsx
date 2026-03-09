'use client';

import * as React from 'react';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useCode } from '@mui/internal-docs-infra/useCode';
import styles from './CollapsibleContent.module.css';

import '@wooorm/starry-night/style/light';

export function CollapsibleContent(props: ContentProps<object>) {
  const code = useCode(props, { preClassName: styles.codeBlock });
  const id = React.useId();
  const checkboxId = `${id}-expand`;

  return (
    <div className={styles.container}>
      {/* Visually hidden checkbox provides no-JS toggle state via CSS :checked */}
      <input type="checkbox" id={checkboxId} className={styles.checkbox} />
      <div className={styles.code}>{code.selectedFile}</div>
      <label htmlFor={checkboxId} className={styles.toggle}>
        <span className={styles.expandLabel}>Expand</span>
        <span className={styles.collapseLabel}>Collapse</span>
      </label>
    </div>
  );
}
