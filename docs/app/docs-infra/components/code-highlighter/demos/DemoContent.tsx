'use client';

import * as React from 'react';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useDemo } from '@mui/internal-docs-infra/useDemo';
import { Tabs } from '@/components/Tabs';
import { CodeActionsMenu } from './CodeActionsMenu';
import { CodeBlockHeader, CodeBlockHeaderLabel } from './CodeBlockHeader';
import { DemoVariantBar } from './DemoVariantBar';
import styles from './DemoContent.module.css';

import './syntax.css';

const variantNames: Record<string, string | undefined> = {
  CssModules: 'CSS Modules',
};

export function DemoContent(props: ContentProps<object>) {
  // @focus-start
  const demo = useDemo(props, { preClassName: styles.codeBlock });

  const hasJsTransform = demo.availableTransforms.includes('js');
  const isJsSelected = demo.selectedTransform === 'js';

  const toggleJs = React.useCallback(
    (enabled: boolean) => {
      demo.selectTransform(enabled ? 'js' : null);
    },
    [demo],
  );

  const tabs = React.useMemo(
    () => demo.files.map(({ name, slug }) => ({ id: name, name, slug })),
    [demo.files],
  );
  const variants = React.useMemo(
    () =>
      demo.variants.map((variant) => ({ value: variant, label: variantNames[variant] || variant })),
    [demo.variants],
  );

  const hasTabs = tabs.length > 1;

  return (
    <div>
      {demo.allFilesSlugs.map(({ slug }) => (
        <span key={slug} id={slug} className={styles.fileRefs} />
      ))}
      <div className={styles.container}>
        <div className={styles.demoSection}>
          <DemoVariantBar
            variants={variants}
            selectedVariant={demo.selectedVariant}
            onVariantChange={demo.selectVariant}
          />
          <div className={styles.demoSurface}>{demo.component}</div>
        </div>
        <div className={styles.codeSection}>
          <CodeBlockHeader
            menu={
              <CodeActionsMenu
                inline={!hasTabs}
                onCopy={demo.copy}
                onCopyMarkdown={hasTabs ? demo.copyMarkdown : undefined}
                fileUrl={demo.selectedFileUrl}
                fileName={demo.selectedFileName}
                jsTransform={
                  hasJsTransform ? { enabled: isJsSelected, onToggle: toggleJs } : undefined
                }
              />
            }
          >
            {hasTabs ? (
              <Tabs
                tabs={tabs}
                selectedTabId={demo.selectedFileName}
                onTabSelect={demo.selectFileName}
              />
            ) : (
              <CodeBlockHeaderLabel>{demo.selectedFileName}</CodeBlockHeaderLabel>
            )}
          </CodeBlockHeader>
          <div className={styles.code}>{demo.selectedFile}</div>
        </div>
      </div>
    </div>
  );
  // @focus-end
}
