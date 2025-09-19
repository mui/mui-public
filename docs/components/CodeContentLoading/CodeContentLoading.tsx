'use client';

import * as React from 'react';
import type { ContentLoadingProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { Tabs } from '@/components/Tabs';
import { Select } from '@/components/Select';
import styles from '../../app/docs-infra/components/code-highlighter/demos/CodeContent.module.css';
import loadingStyles from './CodeContentLoading.module.css';

import '@wooorm/starry-night/style/light';

const variantNames: Record<string, string | undefined> = {
  CssModules: 'CSS Modules',
};

export function CodeContentLoading(props: ContentLoadingProps<object>) {
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

  return (
    <div>
      {Object.keys(props.extraSource || {}).map((slug) => (
        <span key={slug} id={slug} className={styles.fileRefs} />
      ))}
      <div className={styles.container}>
        <div className={styles.demoSection}>{props.component}</div>
        <div className={styles.codeSection}>
          <div className={styles.header}>
            <div className={styles.headerContainer}>
              {tabs && (
                <div className={styles.tabContainer}>
                  <Tabs
                    tabs={tabs}
                    selectedTabId={props.fileNames?.[0]}
                    onTabSelect={onTabSelect}
                    disabled={true}
                  />
                </div>
              )}
              <div className={styles.headerActions}>
                {Object.keys(props.extraVariants || {}).length >= 1 && (
                  <Select items={variants} value={variants[0]?.value} disabled={true} />
                )}
              </div>
            </div>
          </div>
          <div className={styles.code}>
            <pre className={styles.codeBlock}>{props.source}</pre>
          </div>
          <div className={loadingStyles.extraFiles}>
            {Object.keys(props.extraSource || {}).map((slug) => (
              <React.Fragment key={slug}>
                <span>{slug}</span>
                <pre>{props.extraSource?.[slug]}</pre>
              </React.Fragment>
            ))}
          </div>
          <div className={loadingStyles.extraVariants}>
            {Object.keys(props.extraVariants || {}).map((slug) => (
              <div key={slug} className={loadingStyles.extraVariant}>
                <h3>Variant: {slug}</h3>
                <span>{props.extraVariants?.[slug].fileNames?.[0]}</span>
                <pre>{props.extraVariants?.[slug].source}</pre>
                {Object.keys(props.extraVariants?.[slug].extraSource || {}).map((key) => (
                  <React.Fragment key={key}>
                    <span>{key}</span>
                    <pre>{props.extraVariants?.[slug]?.extraSource?.[key]}</pre>
                  </React.Fragment>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
