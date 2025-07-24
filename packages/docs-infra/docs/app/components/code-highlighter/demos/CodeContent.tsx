'use client';

import * as React from 'react';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter';
import { useCode } from '@mui/internal-docs-infra/useCode';
import Switch from '@/components/Switch/Switch';
import { CopyButton } from '@/components/CopyButton';
import styles from './CodeContent.module.css';

import '@wooorm/starry-night/style/light'; // load the light theme for syntax highlighting

export function CodeContent(props: ContentProps<{}>) {
  const code = useCode(props);

  const hasJsTransform = code.availableTransforms.includes('js');
  const isJsSelected = code.selectedTransform === 'js';

  const toggleJs = React.useCallback(() => {
    code.selectTransform(isJsSelected ? null : 'js');
  }, [code, isJsSelected]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.name}>{code.selectedFileName}</span>
        <div className={styles.headerActions}>
          <CopyButton copy={code.copy} copyDisabled={code.copyDisabled} />
          <div className={hasJsTransform ? styles.switchContainer : styles.switchContainerHidden}>
            <Switch
              value={isJsSelected}
              onChange={toggleJs}
              options={[
                { label: 'TS', value: false },
                { label: 'JS', value: true },
              ]}
            />
          </div>
        </div>
      </div>
      <pre className={styles.codeBlock}>{code.selectedFile}</pre>
    </div>
  );
}
