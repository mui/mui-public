'use client';

import * as React from 'react';
import { useEditable } from 'use-editable';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useCode } from '@mui/internal-docs-infra/useCode';
import { Tabs } from '@/components/Tabs';
import styles from '../code-editor/CodeEditorContent.module.css';

import '@wooorm/starry-night/style/light';

export function MultiFileContent(props: ContentProps<object>) {
  const preRef = React.useRef<HTMLPreElement | null>(null);
  const code = useCode(props, { preClassName: styles.codeBlock, preRef });

  const tabs = React.useMemo(() => {
    return code.files.map(({ name }) => ({
      id: name,
      name,
    }));
  }, [code.files]);

  const onInput = React.useCallback(
    (text: string) => {
      code.setSource?.(text);
    },
    [code],
  );

  useEditable(preRef, onInput, { indentation: 2 });

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Tabs
            tabs={tabs}
            selectedTabId={code.selectedFileName || ''}
            onTabSelect={code.selectFileName}
          />
        </div>
      </div>
      <div className={styles.code}>{code.selectedFile}</div>
    </div>
  );
}
