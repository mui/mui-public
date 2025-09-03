'use client';

import * as React from 'react';
import type { ContentLoadingProps } from '@mui/internal-docs-infra/CodeHighlighter';
import { Tabs } from '@/components/Tabs';
import styles from '../DemoContent.module.css';

import '@wooorm/starry-night/style/light';

const variantNames: Record<string, string | undefined> = {
  CssModules: 'CSS Modules',
};

export function DemoContentLoading(props: ContentLoadingProps<object>) {
  const tabs = React.useMemo(
    () =>
      props.fileNames?.map((name) => ({
        id: name || '',
        name: name || '',
        slug: name,
      })),
    [props.fileNames],
  );

  const onTabSelect = React.useCallback((tabId: string) => {
    // No-op
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
            </div>
          </div>
          <div className={styles.code}>
            <pre className={styles.codeBlock}>{props.source}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}
