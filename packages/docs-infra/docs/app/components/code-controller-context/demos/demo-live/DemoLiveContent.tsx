'use client';

import * as React from 'react';
import { useEditable } from 'use-editable';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter';
import { useDemo } from '@mui/internal-docs-infra/useDemo';
import { LabeledSwitch } from '../../../../../components/LabeledSwitch';
import { Tabs } from '../../../../../components/Tabs';
import styles from './DemoLiveContent.module.css';

import '@wooorm/starry-night/style/light';
import Select from '../../../../../components/Select/Select';

const variantNames: Record<string, string | undefined> = {
  CssModules: 'CSS Modules',
};

export function DemoLiveContent(props: ContentProps<object>) {
  const demo = useDemo(props);

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
    () => demo.files.map(({ name }) => ({ id: name, name })),
    [demo.files],
  );
  const variants = React.useMemo(
    () =>
      demo.variants.map((variant) => ({ value: variant, label: variantNames[variant] || variant })),
    [demo.variants],
  );

  const editorRef = React.useRef(null);
  const onChange = React.useCallback(
    (text: string) => {
      demo.setSource?.(text);
    },
    [demo],
  );
  useEditable(editorRef, onChange, { indentation: 2, disabled: !demo.setSource });

  return (
    <div className={styles.container}>
      <div className={styles.demoSection}>{demo.component}</div>
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
        <div className={styles.code}>
          <pre className={styles.codeBlock} ref={editorRef}>
            {demo.selectedFile}
          </pre>
        </div>
      </div>
    </div>
  );
}
