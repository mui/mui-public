'use client';

import * as React from 'react';
import type { ContentLoadingProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useCodeFallback } from '@mui/internal-docs-infra/CodeHighlighter';
import { hastToJsx } from '@mui/internal-docs-infra/pipeline/hastUtils';
import { Tabs } from '@/components/Tabs';
import { Select } from '@/components/Select';
import styles from '../DemoContent.module.css';
import loadingStyles from './DemoContentLoading.module.css';

import '../syntax.css';

const variantNames: Record<string, string | undefined> = {
  CssModules: 'CSS Modules',
};

export function DemoContentLoading(props: ContentLoadingProps<object>) {
  const { source, extraSource, extraVariants } = useCodeFallback(props);
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
      {Object.keys(extraSource || {}).map((slug) => (
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
                {Object.keys(extraVariants || {}).length >= 1 && (
                  <Select items={variants} value={variants[0]?.value} disabled={true} />
                )}
              </div>
            </div>
          </div>
          <div className={styles.code}>
            <pre className={styles.codeBlock}>{source ? hastToJsx(source) : null}</pre>
          </div>
          <div className={loadingStyles.extraFiles}>
            {Object.keys(extraSource || {}).map((slug) => (
              <pre key={slug}>{extraSource?.[slug] ? hastToJsx(extraSource[slug]) : null}</pre>
            ))}
          </div>
          <div className={loadingStyles.extraVariants}>
            {Object.keys(extraVariants || {}).map((slug) => (
              <div key={slug} className={loadingStyles.extraVariant}>
                <span>{slug}</span>
                <pre>
                  {Object.keys(extraVariants?.[slug].extraSource || {}).map((key) => (
                    <div key={key}>
                      <strong>{key}:</strong>{' '}
                      {extraVariants?.[slug]?.extraSource?.[key]
                        ? hastToJsx(extraVariants[slug].extraSource![key])
                        : null}
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
}
