'use client';

import * as React from 'react';
import type { ContentLoadingProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { Tabs } from '@/components/Tabs';
import { CodeActionsMenu } from '../CodeActionsMenu';
import { CodeBlockHeader, CodeBlockHeaderLabel } from '../CodeBlockHeader';
import { DemoVariantBar } from '../DemoVariantBar';
import styles from '../DemoContent.module.css';
import loadingStyles from './DemoContentLoading.module.css';

import '../syntax.css';

const variantNames: Record<string, string | undefined> = {
  CssModules: 'CSS Modules',
};

export function DemoContentLoading(props: ContentLoadingProps<object>) {
  // @focus-start
  const tabs = React.useMemo(
    () =>
      props.fileNames?.map((name) => ({
        id: name || '',
        name: name || '',
        slug: name,
      })),
    [props.fileNames],
  );
  const variants = React.useMemo(
    () =>
      Object.keys(props.components || {}).map((variant) => ({
        value: variant,
        label: variantNames[variant] || variant,
      })),
    [props.components],
  );

  const onTabSelect = React.useCallback(() => {
    // Handle tab selection
  }, []);

  const firstFileName = props.fileNames?.[0];
  const showTabs = !!tabs && tabs.length > 1;

  return (
    <div>
      {Object.keys(props.extraSource || {}).map((slug) => (
        <span key={slug} id={slug} className={styles.fileRefs} />
      ))}
      <div className={styles.container}>
        <div className={styles.demoSection}>
          <DemoVariantBar variants={variants} selectedVariant={variants[0]?.value} disabled />
          {props.component}
        </div>
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
          <div className={loadingStyles.extraFiles}>
            {Object.keys(props.extraSource || {}).map((slug) => (
              <pre key={slug}>{props.extraSource?.[slug]}</pre>
            ))}
          </div>
          <div className={loadingStyles.extraVariants}>
            {Object.keys(props.extraVariants || {}).map((slug) => (
              <div key={slug} className={loadingStyles.extraVariant}>
                <span>{slug}</span>
                <pre>
                  {Object.keys(props.extraVariants?.[slug].extraSource || {}).map((key) => (
                    <div key={key}>
                      <strong>{key}:</strong> {props.extraVariants?.[slug]?.extraSource?.[key]}
                    </div>
                  ))}
                </pre>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
  // @focus-end
}
