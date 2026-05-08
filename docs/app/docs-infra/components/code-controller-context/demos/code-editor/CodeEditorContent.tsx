'use client';

import * as React from 'react';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useCode } from '@mui/internal-docs-infra/useCode';
import { LabeledSwitch } from '@/components/LabeledSwitch';
import styles from './CodeEditorContent.module.css';

import '../../../code-highlighter/demos/syntax.css';

export function CodeEditorContent(props: ContentProps<object>) {
  const code = useCode(props, { preClassName: styles.codeBlock });

  const hasJsTransform = code.availableTransforms.includes('js');
  const isJsSelected = code.selectedTransform === 'js';
  const labels = { false: 'TS', true: 'JS' };
  const toggleJs = React.useCallback(
    (checked: boolean) => {
      code.selectTransform(checked ? 'js' : null);
    },
    [code],
  );

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.name}>{code.selectedFileName}</span>
        <div className={styles.headerActions}>
          {hasJsTransform && (
            <div className={styles.switchContainer}>
              <LabeledSwitch checked={isJsSelected} onCheckedChange={toggleJs} labels={labels} />
            </div>
          )}
        </div>
      </div>
      <div className={styles.code}>{code.selectedFile}</div>
    </div>
  );
  // @focus-end
}
