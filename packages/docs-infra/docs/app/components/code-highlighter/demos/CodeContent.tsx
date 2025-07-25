'use client';

import * as React from 'react';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter';
import { useCode } from '@mui/internal-docs-infra/useCode';
import { LabeledSwitch } from '@/components/LabeledSwitch';
import { CopyButton } from '@/components/CopyButton';
import styles from './CodeContent.module.css';

import '@wooorm/starry-night/style/light'; // load the light theme for syntax highlighting

export function CodeContent(props: ContentProps<{}>) {
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

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.name}>{code.selectedFileName}</span>
        <div className={styles.headerActions}>
          <CopyButton copy={code.copy} copyDisabled={code.copyDisabled} />
          {hasJsTransform && (
            <div className={styles.switchContainer}>
              <LabeledSwitch checked={isJsSelected} onCheckedChange={toggleJs} labels={labels} />
            </div>
          )}
        </div>
      </div>
      <div className={styles.code}>
        <pre className={styles.codeBlock}>{code.selectedFile}</pre>
      </div>
    </div>
  );
}
