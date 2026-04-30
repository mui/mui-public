'use client';

import * as React from 'react';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useDemo } from '@mui/internal-docs-infra/useDemo';
import { Tabs } from '@/components/Tabs';
import { CodeActionsMenu } from '../../../components/code-highlighter/demos/CodeActionsMenu';
import { CodeBlockHeader } from '../../../components/code-highlighter/demos/CodeBlockHeader';
import styles from './CollapsibleDemoContent.module.css';
import { useScrollAnchor } from './useScrollAnchor';

import '@wooorm/starry-night/style/light';

export function CollapsibleDemoContent(props: ContentProps<object>) {
  // @focus-start @padding 1
  const demo = useDemo(props, { preClassName: styles.codeBlock });

  const tabs = React.useMemo(
    () => demo.files.map(({ name, slug }) => ({ id: name, name, slug })),
    [demo.files],
  );

  const id = React.useId();
  const checkboxId = `${id}-expand`;
  const { containerRef, toggleRef, anchorScroll } = useScrollAnchor();
  const blurPointerFocus = React.useCallback((event: React.FocusEvent<HTMLInputElement>) => {
    if (!event.currentTarget.matches(':focus-visible')) {
      event.currentTarget.blur();
    }
  }, []);

  return (
    <div>
      {demo.allFilesSlugs.map(({ slug }) => (
        <span key={slug} id={slug} className={styles.fileRefs} />
      ))}
      <div className={styles.container}>
        <div className={styles.demoSection}>{demo.component}</div>
        <div ref={containerRef} className={styles.codeSection}>
          <CodeBlockHeader
            menu={
              <CodeActionsMenu
                onCopy={demo.copy}
                fileUrl={demo.selectedFileUrl}
                fileName={demo.selectedFileName}
              />
            }
          >
            <Tabs
              tabs={tabs}
              selectedTabId={demo.selectedFileName}
              onTabSelect={demo.selectFileName}
            />
          </CodeBlockHeader>
          <div className={styles.code}>{demo.selectedFile}</div>
          {/* Visually hidden checkbox provides no-JS toggle state via CSS :checked */}
          <input
            type="checkbox"
            id={checkboxId}
            className={styles.checkbox}
            onFocus={blurPointerFocus}
            onChange={(event) => {
              anchorScroll(event.target.checked ? 'expand' : 'collapse');
            }}
          />
          <label ref={toggleRef} htmlFor={checkboxId} className={styles.toggle}>
            <span className={styles.expandLabel}>Expand</span>
            <span className={styles.collapseLabel}>Collapse</span>
          </label>
        </div>
      </div>
    </div>
  );
  // @focus-end
}
