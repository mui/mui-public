'use client';

import * as React from 'react';
import { useEditable } from 'use-editable';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useDemo } from '@mui/internal-docs-infra/useDemo';
import { useScrollAnchor } from '@mui/internal-docs-infra/useScrollAnchor';
import { Tabs } from '@/components/Tabs';
import { CodeActionsMenu } from '../../../code-highlighter/demos/CodeActionsMenu';
import {
  CodeBlockHeader,
  CodeBlockHeaderLabel,
} from '../../../code-highlighter/demos/CodeBlockHeader';
import { DemoVariantBar } from '../../../code-highlighter/demos/DemoVariantBar';
import styles from './DemoLiveContent.module.css';

import '../../../code-highlighter/demos/syntax.css';

const variantNames: Record<string, string | undefined> = {
  CssModules: 'CSS Modules',
};

export function DemoLiveContent(props: ContentProps<object>) {
  // @focus-start @padding 1
  const preRef = React.useRef<HTMLPreElement | null>(null);
  const demo = useDemo(props, {
    preClassName: styles.codeBlock,
    preRef,
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
    () => demo.files.map(({ name }) => ({ id: name, name })),
    [demo.files],
  );
  const variants = React.useMemo(
    () =>
      demo.variants.map((variant) => ({ value: variant, label: variantNames[variant] || variant })),
    [demo.variants],
  );

  const onChange = React.useCallback(
    (text: string) => {
      demo.setSource?.(text);
    },
    [demo],
  );
  useEditable(preRef, onChange, { indentation: 2, disabled: !demo.setSource });

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
          <div className={styles.demoSurface}>{demo.component}</div>
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
                onReset={demo.reset}
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
