'use client';

import * as React from 'react';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useDemo } from '@mui/internal-docs-infra/useDemo';
import { useCodeWindow } from '@mui/internal-docs-infra/useCodeWindow';
import { Tabs } from '@/components/Tabs';
import { DemoError } from '@/components/DemoError';
import { CodeActionsMenu } from '../../../components/code-highlighter/demos/CodeActionsMenu';
import { CodeBlockHeader } from '../../../components/code-highlighter/demos/CodeBlockHeader';
import { CodeSource } from '../../../components/code-highlighter/demos/CodeSource';
import styles from './CollapsibleDemoContent.module.css';

export function CollapsibleDemoContent(props: ContentProps<object>) {
  // @focus-start @padding 1
  const demo = useDemo(props, {
    preClassName: styles.codeBlock,
  });

  const hasJsTransform = demo.availableTransforms.includes('js');
  const isJsSelected = demo.selectedTransform === 'js';

  const id = React.useId();
  const checkboxId = `${id}-expand`;
  const { containerRef, toggleRef, anchorScroll } = useCodeWindow<HTMLLabelElement>();

  const toggleJs = (enabled: boolean) => demo.selectTransform(enabled ? 'js' : null);

  const tabs = React.useMemo(
    () => demo.files.map(({ name, slug }) => ({ id: name, name, slug })),
    [demo.files],
  );

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
        <div className={styles.demoSection}>
          <DemoError error={demo.error} />
          {demo.component}
        </div>
        <div ref={containerRef} className={styles.codeSection}>
          <CodeBlockHeader
            menu={
              <CodeActionsMenu
                onCopy={demo.copy}
                onCopyMarkdown={demo.copyMarkdown}
                fileUrl={demo.selectedFileUrl}
                fileName={demo.selectedFileName}
                fileSlug={demo.selectedFileSlug}
                jsTransform={
                  hasJsTransform ? { enabled: isJsSelected, onToggle: toggleJs } : undefined
                }
              />
            }
          >
            <Tabs
              tabs={tabs}
              selectedTabId={demo.selectedFileName}
              onTabSelect={demo.selectFileName}
            />
          </CodeBlockHeader>
          <CodeSource className={styles.code}>{demo.selectedFile}</CodeSource>
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
