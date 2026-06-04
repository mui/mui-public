'use client';

import * as React from 'react';
import type { ContentLoadingProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useCodeFallback } from '@mui/internal-docs-infra/CodeHighlighter';
import { generateFileSlug } from '@mui/internal-docs-infra/pipeline/loaderUtils';
import { Tabs } from '@/components/Tabs';
import { CodeActionsMenu } from '../../../components/code-highlighter/demos/CodeActionsMenu';
import { CodeBlockHeader } from '../../../components/code-highlighter/demos/CodeBlockHeader';
import styles from './CollapsibleDemoContent.module.css';

import '@wooorm/starry-night/style/light';

/**
 * Pre-hydration fallback for {@link CollapsibleDemoContent}. Renders the live
 * demo immediately and mirrors the collapsed code window (tabs, loading actions
 * menu, truncated code, Expand toggle) using the same CSS, so the code sits at
 * its final position before highlighting swaps in.
 */
export function CollapsibleDemoContentLoading(props: ContentLoadingProps<object>) {
  // @focus-start @padding 1
  // `code` is the ready `<code>` for the displayed file — the hook applies
  // `data-filename`, `data-collapsible`, the line counts and the `language-` class,
  // matching `<Pre>`.
  const { code } = useCodeFallback(props);
  const mainSlug = props.slug ?? '';
  const mainVariant = props.initialVariant ?? 'Default';
  const id = React.useId();
  const checkboxId = `${id}-expand`;
  const firstFileName = props.fileNames?.[0];

  const tabs = React.useMemo(
    () =>
      props.fileNames?.map((name) => ({
        id: name || '',
        name: name || '',
        slug: generateFileSlug(mainSlug, name || '', mainVariant),
      })),
    [props.fileNames, mainSlug, mainVariant],
  );

  const onTabSelect = React.useCallback(() => {
    // No-op while loading.
  }, []);

  return (
    <div>
      {(props.fileNames ?? []).map((name) => (
        <span
          key={name}
          id={generateFileSlug(mainSlug, name, mainVariant)}
          className={styles.fileRefs}
        />
      ))}
      <div className={styles.container}>
        <div className={styles.demoSection}>{props.component}</div>
        <div className={styles.codeSection}>
          <CodeBlockHeader menu={<CodeActionsMenu loading />}>
            {tabs && tabs.length > 0 && (
              <Tabs tabs={tabs} selectedTabId={firstFileName} onTabSelect={onTabSelect} disabled />
            )}
          </CodeBlockHeader>
          <div className={styles.code}>
            <pre className={styles.codeBlock}>{code}</pre>
          </div>
          {/* No-JS collapse toggle — the CSS `:checked` state drives the window. */}
          <input type="checkbox" id={checkboxId} className={styles.checkbox} />
          <label htmlFor={checkboxId} className={styles.toggle}>
            <span className={styles.expandLabel}>Expand</span>
            <span className={styles.collapseLabel}>Collapse</span>
          </label>
        </div>
      </div>
    </div>
  );
  // @focus-end
}
