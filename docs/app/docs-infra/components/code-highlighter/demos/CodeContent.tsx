'use client';

import * as React from 'react';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useCode } from '@mui/internal-docs-infra/useCode';
import { Tabs } from '@/components/Tabs';
import { CodeActionsMenu } from './CodeActionsMenu';
import { CodeBlockHeader, CodeBlockHeaderLabel } from './CodeBlockHeader';
import styles from './CodeContent.module.css';

import './syntax.css';

const variantNames: Record<string, string | undefined> = {
  CssModules: 'CSS Modules',
};

export function CodeContent(props: ContentProps<object>) {
  // @focus-start
  const code = useCode(props, { preClassName: styles.codeBlock });

  const hasJsTransform = code.availableTransforms.includes('js');
  const isJsSelected = code.selectedTransform === 'js';

  const toggleJs = React.useCallback(
    (enabled: boolean) => {
      code.selectTransform(enabled ? 'js' : null);
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

  const hasTabs = tabs.length > 1;

  return (
    <div>
      {code.allFilesSlugs.map(({ slug }) => (
        <span key={slug} id={slug} />
      ))}
      <div className={styles.container}>
        <CodeBlockHeader
          roundedTop
          menu={
            <CodeActionsMenu
              inline={!hasTabs}
              onCopy={code.copy}
              fileUrl={code.selectedFileUrl}
              jsTransform={
                hasJsTransform ? { enabled: isJsSelected, onToggle: toggleJs } : undefined
              }
              variants={
                variants.length > 1
                  ? {
                      items: variants,
                      selected: code.selectedVariant,
                      onChange: code.selectVariant,
                    }
                  : undefined
              }
            />
          }
        >
          {hasTabs ? (
            <Tabs
              tabs={tabs}
              selectedTabId={code.selectedFileName}
              onTabSelect={code.selectFileName}
            />
          ) : (
            <CodeBlockHeaderLabel>{code.selectedFileName}</CodeBlockHeaderLabel>
          )}
        </CodeBlockHeader>
        <div className={styles.code}>{code.selectedFile}</div>
      </div>
    </div>
  );
  // @focus-end
}
