'use client';

import * as React from 'react';
import type { ContentLoadingProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { Tabs } from '@/components/Tabs';
import { CodeActionsMenu } from '../../app/docs-infra/components/code-highlighter/demos/CodeActionsMenu';
import {
  CodeBlockHeader,
  CodeBlockHeaderLabel,
} from '../../app/docs-infra/components/code-highlighter/demos/CodeBlockHeader';
import styles from '../../app/docs-infra/components/code-highlighter/demos/DemoContent.module.css';

import '../../app/docs-infra/components/code-highlighter/demos/syntax.css';

export function DemoPerformanceContentLoading(props: ContentLoadingProps<object>) {
  const tabs = React.useMemo(
    () =>
      props.fileNames?.map((name) => ({
        id: name || '',
        name: name || '',
        slug: name,
      })),
    [props.fileNames],
  );

  const onTabSelect = React.useCallback(() => {
    // No-op
  }, []);

  const firstFileName = props.fileNames?.[0];
  const showTabs = !!tabs && tabs.length > 1;

  return (
    <div>
      {Object.keys(props.extraSource || {}).map((slug) => (
        <span key={slug} id={slug} className={styles.fileRefs} />
      ))}
      <div className={styles.container}>
        <div className={styles.demoSection} />
        <div className={styles.codeSection}>
          <CodeBlockHeader menu={<CodeActionsMenu loading inline={!showTabs} />}>
            {showTabs && (
              <Tabs tabs={tabs} selectedTabId={firstFileName} onTabSelect={onTabSelect} disabled />
            )}
            {!showTabs && firstFileName && (
              <CodeBlockHeaderLabel>{firstFileName}</CodeBlockHeaderLabel>
            )}
          </CodeBlockHeader>
          <div className={styles.code}>
            <pre className={styles.codeBlock}>{props.source}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}
