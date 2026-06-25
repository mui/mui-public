'use client';

import * as React from 'react';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useDemo } from '@mui/internal-docs-infra/useDemo';
import { useScrollAnchor } from '@mui/internal-docs-infra/useScrollAnchor';
import { Tabs } from '@/components/Tabs';
import { DemoError } from '@/components/DemoError';
import { CodeActionsMenu } from './CodeActionsMenu';
import { CodeBlockHeader, CodeBlockHeaderLabel } from './CodeBlockHeader';
import { CodeSource } from './CodeSource';
import { DemoVariantBar } from './DemoVariantBar';
import styles from './DemoContent.module.css';

const variantNames: Record<string, string | undefined> = {
  CssModules: 'CSS Modules',
};

export function DemoContent(props: ContentProps<object>) {
  // @focus-start
  const demo = useDemo(props, {
    preClassName: styles.codeBlock,
    transformDelay: 350,
    variantSwapDelay: 350,
  });

  const hasJsTransform = demo.availableTransforms.includes('js');
  const isJsSelected = demo.selectedTransform === 'js';

  // Scroll-anchor session for the JS/TS transform swap. Keeps the toggle
  // (or the action-menu trigger that fronts it) pinned under the user's
  // pointer while the code height changes during the swap.
  const { containerRef: transformAnchorRef, anchorScroll: anchorTransformScroll } =
    useScrollAnchor<HTMLDivElement>();

  const toggleJs = React.useCallback(
    (enabled: boolean, anchorEl: HTMLElement | null) => {
      if (anchorEl) {
        anchorTransformScroll(anchorEl, 700);
      }
      demo.selectTransform(enabled ? 'js' : null);
    },
    [demo, anchorTransformScroll],
  );

  // Scroll-anchor session for variant swaps. Keeps the variant selector
  // pinned while the side-by-side demo/code panels reflow.
  const { containerRef: variantAnchorRef, anchorScroll: anchorVariantScroll } =
    useScrollAnchor<HTMLDivElement>();

  const selectVariant = React.useCallback(
    (variant: string | null, anchorEl: HTMLElement | null) => {
      if (anchorEl) {
        anchorVariantScroll(anchorEl, 700);
      }
      demo.selectVariant(variant);
    },
    [demo, anchorVariantScroll],
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
      <div ref={variantAnchorRef} className={styles.container}>
        <div className={styles.demoSection}>
          <DemoVariantBar
            variants={variants}
            selectedVariant={demo.selectedVariant}
            onVariantChange={selectVariant}
          />
          <div className={styles.demoSurface}>
            <DemoError error={demo.error} />
            {demo.component}
          </div>
        </div>
        <div ref={transformAnchorRef} className={styles.codeSection}>
          <CodeBlockHeader
            pending={demo.pendingTransform}
            menu={
              <CodeActionsMenu
                inline={!hasTabs}
                onCopy={demo.copy}
                onCopyMarkdown={hasTabs ? demo.copyMarkdown : undefined}
                fileUrl={demo.selectedFileUrl}
                fileName={demo.selectedFileName}
                fileSlug={demo.selectedFileSlug}
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
          <CodeSource className={styles.code}>{demo.selectedFile}</CodeSource>
        </div>
      </div>
    </div>
  );
  // @focus-end
}
