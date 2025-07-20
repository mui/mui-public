'use client';

import * as React from 'react';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter';
import { useDemo } from '@mui/internal-docs-infra/useDemo';
import Switch from '@/components/Switch/Switch';
import { Tabs } from '@/components/Tabs';
import styles from './DemoContent.module.css';

import '@wooorm/starry-night/style/light';

export function DemoContent(props: ContentProps) {
  const demo = useDemo(props);

  const hasJsTransform = demo.availableTransforms.includes('js');
  const isJsSelected = demo.selectedTransform === 'js';

  const toggleJs = React.useCallback(() => {
    demo.selectTransform(isJsSelected ? null : 'js');
  }, [demo, isJsSelected]);

  return (
    <div className={styles.container}>
      <div className={styles.demoSection}>{demo.component}</div>
      <div className={styles.codeSection}>
        <div className={styles.header}>
          <div className={styles.tabContainer}>
            <Tabs
              tabs={demo.files.map((file: { name: string; component: React.ReactNode }) => ({
                name: file.name,
                id: file.name,
              }))}
              selectedTabId={demo.selectedFileName}
              onTabSelect={demo.selectFileName}
            />
          </div>
          <div className={hasJsTransform ? styles.switchContainer : styles.switchContainerHidden}>
            <Switch
              value={isJsSelected}
              onChange={toggleJs}
              options={[
                { label: 'TS', value: false },
                { label: 'JS', value: true },
              ]}
            />
          </div>
        </div>
        <pre className={styles.codeBlock}>{demo.selectedFile}</pre>
      </div>
    </div>
  );
}
