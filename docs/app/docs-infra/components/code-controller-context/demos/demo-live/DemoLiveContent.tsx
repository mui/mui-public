'use client';

import * as React from 'react';
import { useEditable } from 'use-editable';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useDemo } from '@mui/internal-docs-infra/useDemo';
import { Tabs } from '@/components/Tabs';
import { CodeActionsMenu } from '../../../code-highlighter/demos/CodeActionsMenu';
import {
  CodeBlockHeader,
  CodeBlockHeaderLabel,
} from '../../../code-highlighter/demos/CodeBlockHeader';
import { DemoVariantBar } from '../../../code-highlighter/demos/DemoVariantBar';
import styles from './DemoLiveContent.module.css';

import '../../../code-highlighter/demos/syntax.css';

const variantNames: Record<string, string | undefined> = {
  CssModules: 'CSS Modules',
};

export function DemoLiveContent(props: ContentProps<object>) {
  // @focus-start @padding 1
  const preRef = React.useRef<HTMLPreElement | null>(null);
  const demo = useDemo(props, { preClassName: styles.codeBlock, preRef });

  const hasJsTransform = demo.availableTransforms.includes('js');
  const isJsSelected = demo.selectedTransform === 'js';

  const toggleJs = React.useCallback(
    (enabled: boolean) => {
      demo.selectTransform(enabled ? 'js' : null);
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

  const onChange = React.useCallback(
    (text: string) => {
      demo.setSource?.(text);
    },
    [demo],
  );
  useEditable(preRef, onChange, { indentation: 2, disabled: !demo.setSource });

  const hasTabs = tabs.length > 1;

  return (
    <div className={styles.container}>
      <div className={styles.demoSection}>
        <DemoVariantBar
          variants={variants}
          selectedVariant={demo.selectedVariant}
          onVariantChange={demo.selectVariant}
        />
        {demo.component}
      </div>
      <div className={styles.codeSection}>
        <CodeBlockHeader
          menu={
            <CodeActionsMenu
              inline={!hasTabs}
              onCopy={demo.copy}
              onCopyMarkdown={hasTabs ? demo.copyMarkdown : undefined}
              fileUrl={demo.selectedFileUrl}
              fileName={demo.selectedFileName}
              jsTransform={
                hasJsTransform ? { enabled: isJsSelected, onToggle: toggleJs } : undefined
              }
            />
          }
        >
          {hasTabs ? (
            <Tabs
              tabs={tabs}
              selectedTabId={demo.selectedFileName}
              onTabSelect={demo.selectFileName}
            />
          ) : (
            <CodeBlockHeaderLabel>{demo.selectedFileName}</CodeBlockHeaderLabel>
          )}
        </CodeBlockHeader>
        <div className={styles.code}>{demo.selectedFile}</div>
      </div>
    </div>
  );
  // @focus-end
}
