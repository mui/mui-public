'use client';

import * as React from 'react';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useDemo } from '@mui/internal-docs-infra/useDemo';
import { LabeledSwitch } from '@/components/LabeledSwitch';
import { Tabs } from '@/components/Tabs';
import { CopyButton } from '@/components/CopyButton';
import { Select } from '@/components/Select';
import styles from './CollapsibleDemoContent.module.css';
import { useScrollAnchor } from './useScrollAnchor';

import '@wooorm/starry-night/style/light';

const variantNames: Record<string, string | undefined> = {
  CssModules: 'CSS Modules',
};

export function CollapsibleDemoContent(props: ContentProps<object>) {
  // @focus-start @padding 1
  const demo = useDemo(props, { preClassName: styles.codeBlock });

  const hasJsTransform = demo.availableTransforms.includes('js');
  const isJsSelected = demo.selectedTransform === 'js';

  const labels = { false: 'TS', true: 'JS' };
  const toggleJs = React.useCallback(
    (checked: boolean) => {
      demo.selectTransform(checked ? 'js' : null);
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

  const id = React.useId();
  const checkboxId = `${id}-expand`;
  const { containerRef, anchorScroll } = useScrollAnchor();
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
          <div className={styles.header}>
            <div className={styles.headerContainer}>
              <div className={styles.tabContainer}>
                <Tabs
                  tabs={tabs}
                  selectedTabId={demo.selectedFileName}
                  onTabSelect={demo.selectFileName}
                />
              </div>
              <div className={styles.headerActions}>
                <CopyButton copy={demo.copy} />
                {demo.variants.length > 1 && (
                  <Select
                    items={variants}
                    value={demo.selectedVariant}
                    onValueChange={demo.selectVariant}
                  />
                )}
                {hasJsTransform && (
                  <div className={styles.switchContainer}>
                    <LabeledSwitch
                      checked={isJsSelected}
                      onCheckedChange={toggleJs}
                      labels={labels}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
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
          <label htmlFor={checkboxId} className={styles.toggle}>
            <span className={styles.expandLabel}>Expand</span>
            <span className={styles.collapseLabel}>Collapse</span>
          </label>
        </div>
      </div>
    </div>
  );
  // @focus-end
}
