'use client';

import * as React from 'react';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useCode } from '@mui/internal-docs-infra/useCode';
import { LabeledSwitch } from '@/components/LabeledSwitch';
import { Tabs } from '@/components/Tabs';
import { CopyButton } from '@/components/CopyButton';
import { Select } from '@/components/Select';
import styles from './CodeContent.module.css';

import '@wooorm/starry-night/style/light';

const variantNames: Record<string, string | undefined> = {
  CssModules: 'CSS Modules',
};

export function CodeContent(props: ContentProps<object>) {
  const code = useCode(props, { preClassName: styles.codeBlock });

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
      {code.allFilesSlugs.map(({ slug }) => (
        <span key={slug} id={slug} />
      ))}
      <div className={styles.container}>
        <div className={styles.header}>
          <div className={styles.headerContainer}>
            <div className={styles.tabContainer}>
              {tabs.length > 0 ? (
                <Tabs
                  tabs={tabs}
                  selectedTabId={code.selectedFileName}
                  onTabSelect={code.selectFileName}
                />
              ) : (
                <div className={styles.name}>
                  <span>{code.userProps.name}</span>
                </div>
              )}
            </div>
            <div className={styles.headerActions}>
              <CopyButton copy={code.copy} />
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
        <div className={styles.code}>{code.selectedFile}</div>
      </div>
    </div>
  );
}
