'use client';

import * as React from 'react';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter';
import { useCode } from '@mui/internal-docs-infra/useCode';
import { LabeledSwitch } from '@/components/LabeledSwitch';
import { Tabs } from '@/components/Tabs';
import { CopyButton } from '@/components/CopyButton';
import Select from '@/components/Select/Select';
import styles from './CodeContent.module.css';

import '@wooorm/starry-night/style/light';

const variantNames: Record<string, string | undefined> = {
  CssModules: 'CSS Modules',
};

export function CodeContent(props: ContentProps<{}>) {
  const code = useCode(props);

  const hasJsTransform = code.availableTransforms.includes('js');
  const isJsSelected = code.selectedTransform === 'js';

  const labels = { false: 'TS', true: 'JS' };
  const toggleJs = React.useCallback(
    (checked: boolean) => {
      code.selectTransform(checked ? 'js' : null);
    },
    [code],
  );

  const tabs = React.useMemo(
    () => code.files.map(({ name }) => ({ id: name, name })),
    [code.files],
  );
  const variants = React.useMemo(
    () =>
      code.variants.map((variant) => ({ value: variant, label: variantNames[variant] || variant })),
    [code.variants],
  );

  return (
    <div>
      {code.files.map(({ slug }) => (
        <span key={slug} id={slug} />
      ))}
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.headerContainer}>
            <div className={styles.tabContainer}>
              <Tabs
                tabs={tabs}
                selectedTabId={code.selectedFileName}
                onTabSelect={code.selectFileName}
              />
            </div>
            <div className={styles.headerActions}>
              <CopyButton copy={code.copy} copyDisabled={code.copyDisabled} />
              {code.variants.length > 1 && (
                <Select
                  items={variants}
                  value={code.selectedVariant}
                  onValueChange={code.selectVariant}
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
          <pre className={styles.codeBlock}>{code.selectedFile}</pre>
        </div>
      </div>
    </div>
  );
}
