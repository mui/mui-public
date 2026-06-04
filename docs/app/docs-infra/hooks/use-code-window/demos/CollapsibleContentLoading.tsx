'use client';

import * as React from 'react';
import type { ContentLoadingProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useCodeFallback } from '@mui/internal-docs-infra/CodeHighlighter';
import { generateFileSlug } from '@mui/internal-docs-infra/pipeline/loaderUtils';
import { CodeActionsMenu } from '../../../components/code-highlighter/demos/CodeActionsMenu';
import { CodeBlockHeader } from '../../../components/code-highlighter/demos/CodeBlockHeader';
import styles from './CollapsibleContent.module.css';

import '../../../components/code-highlighter/demos/syntax.css';

/**
 * Pre-hydration fallback for {@link CollapsibleContent}. Reuses the same CSS so
 * the collapsed window (header + truncated code + Expand toggle) renders before
 * highlighting, with no layout shift when the interactive content swaps in. The
 * fallback source carries the frame `data-frame-*` attributes, so the collapse
 * CSS truncates it to the focused region just like the live render.
 */
export function CollapsibleContentLoading(props: ContentLoadingProps<object>) {
  // @focus-start @padding 1
  // `code` is the ready `<code>` for the displayed file — `data-filename`,
  // `data-collapsible`, the line counts and the `language-` class are applied by
  // the hook, matching `<Pre>`, so the collapse CSS sizes the window identically
  // before highlighting swaps in.
  const { code, collapsed } = useCodeFallback(props);
  const mainSlug = props.slug ?? '';
  const mainVariant = props.initialVariant ?? 'Default';
  // Seed the no-JS toggle from `initialExpanded` so a block that hydrates
  // expanded also renders expanded during loading (no collapsed flash). When
  // expanded the loading source carries the full content (`fallbackCollapsed`
  // is off), so the toggle stays interactive.
  const initialExpanded = props.initialExpanded === true || props.initialExpanded === 'true';
  const id = React.useId();
  const checkboxId = `${id}-expand`;

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
        <CodeBlockHeader roundedTop menu={<CodeActionsMenu loading inline />} />
        <div className={styles.code}>
          <pre className={styles.codeBlock}>{code}</pre>
        </div>
        {/* No-JS collapse toggle — the CSS `:checked` state drives the window.
            When `collapsed` (a `fallbackCollapsed` block), the fallback only
            carries the visible window, so disable the toggle until the full
            content swaps in and can actually expand. */}
        <input
          type="checkbox"
          id={checkboxId}
          className={styles.checkbox}
          defaultChecked={initialExpanded}
          disabled={collapsed}
        />
        <label htmlFor={checkboxId} className={styles.toggle}>
          <span className={styles.expandLabel}>Expand</span>
          <span className={styles.collapseLabel}>Collapse</span>
        </label>
      </div>
    </div>
  );
  // @focus-end
}
