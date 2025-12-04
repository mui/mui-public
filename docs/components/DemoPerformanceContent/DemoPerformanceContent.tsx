'use client';

import * as React from 'react';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useDemo } from '@mui/internal-docs-infra/useDemo';
import { LabeledSwitch } from '@/components/LabeledSwitch';
import { Tabs } from '@/components/Tabs';
import { CopyButton } from '@/components/CopyButton';
import { Select } from '@/components/Select';
import styles from '../../app/docs-infra/components/code-highlighter/demos/DemoContent.module.css';

import '@wooorm/starry-night/style/light';
import { BenchViewer } from '../BenchViewer';

const variantNames: Record<string, string | undefined> = {
  CssModules: 'CSS Modules',
};

export function DemoPerformanceContent(props: ContentProps<object>) {
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

  return (
    <div>
      {demo.files.map(({ slug }) => (
        <span key={slug} id={slug} className={styles.fileRefs} />
      ))}
      <div className={styles.container}>
        <div className={styles.demoSection}>
          <BenchViewer url={props.url} demo={demo} />
        </div>
        <div className={styles.codeSection}>
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
        </div>
      </div>
    </div>
  );
}
