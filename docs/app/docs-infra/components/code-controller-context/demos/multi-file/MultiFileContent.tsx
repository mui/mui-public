'use client';

import * as React from 'react';
import { useEditable } from 'use-editable';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useCode } from '@mui/internal-docs-infra/useCode';
import { Tabs } from '@/components/Tabs';
import { CodeActionsMenu } from '../../../code-highlighter/demos/CodeActionsMenu';
import {
  CodeBlockHeader,
  CodeBlockHeaderLabel,
} from '../../../code-highlighter/demos/CodeBlockHeader';
import styles from '../code-editor/CodeEditorContent.module.css';

import '../../../code-highlighter/demos/syntax.css';

export function MultiFileContent(props: ContentProps<object>) {
  // @focus-start @padding 1
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

  const hasTabs = tabs.length > 1;

  return (
    <div className={styles.container}>
      <CodeBlockHeader
        roundedTop
        menu={
          <CodeActionsMenu inline={!hasTabs} onCopy={code.copy} fileUrl={code.selectedFileUrl} />
        }
      >
        {hasTabs ? (
          <Tabs
            tabs={tabs}
            selectedTabId={code.selectedFileName || ''}
            onTabSelect={code.selectFileName}
          />
        ) : (
          <CodeBlockHeaderLabel>{code.selectedFileName}</CodeBlockHeaderLabel>
        )}
      </CodeBlockHeader>
      <div className={styles.code}>{code.selectedFile}</div>
    </div>
  );
  // @focus-end
}
