'use client';

import * as React from 'react';
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
  const code = useCode(props, { preClassName: styles.codeBlock });

  const tabs = React.useMemo(() => {
    return code.files.map(({ name, slug }) => ({
      id: name,
      name,
      slug,
    }));
  }, [code.files]);

  const hasTabs = tabs.length > 1;

  return (
    <div>
      {code.allFilesSlugs.map(({ slug }) => (
        <span key={slug} id={slug} className={styles.fileRefs} />
      ))}
      <div className={styles.container}>
        <CodeBlockHeader
          roundedTop
          pending={code.pendingTransform}
          menu={
            <CodeActionsMenu
              inline={!hasTabs}
              onCopy={code.copy}
              onCopyMarkdown={hasTabs ? code.copyMarkdown : undefined}
              fileUrl={code.selectedFileUrl}
              fileName={code.selectedFileName}
              fileSlug={code.selectedFileSlug}
              onReset={code.reset}
            />
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
    </div>
  );
  // @focus-end
}
