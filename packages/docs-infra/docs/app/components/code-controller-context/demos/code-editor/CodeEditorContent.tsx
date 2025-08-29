'use client';

import * as React from 'react';
import { useEditable } from 'use-editable';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter';
import { useCode } from '@mui/internal-docs-infra/useCode';
import { LabeledSwitch } from '@/components/LabeledSwitch';
import styles from './CodeEditorContent.module.css';

import '@wooorm/starry-night/style/light'; // load the light theme for syntax highlighting

export function CodeEditorContent(props: ContentProps<object>) {
  const code = useCode(props);

  const hasJsTransform = code.availableTransforms.includes('js');
  const isJsSelected = code.selectedTransform === 'js';
  const labels = { false: 'TS', true: 'JS' };
  const toggleJs = React.useCallback(
    (checked: boolean) => {
      code.selectTransform(checked ? 'js' : null);
    },
    [code],
  );

  const onInput = React.useCallback(
    (text: string) => {
      code.setSource?.(text);
    },
    [code],
  );

  const editorRef = React.useRef(null);

  useEditable(editorRef, onInput, { indentation: 2 });

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
      <div className={styles.code}>
        <pre className={styles.codeBlock} ref={editorRef}>
          {code.selectedFile}
        </pre>
      </div>
    </div>
  );
}
