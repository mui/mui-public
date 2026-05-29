'use client';

import * as React from 'react';
import type { ContentLoadingProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useCodeFallback } from '@mui/internal-docs-infra/CodeHighlighter';
import { hastToJsx } from '@mui/internal-docs-infra/pipeline/hastUtils';
import { generateFileSlug } from '@mui/internal-docs-infra/pipeline/loaderUtils';
import { CodeActionsMenu } from '../../../components/code-highlighter/demos/CodeActionsMenu';
import { CodeBlockHeader } from '../../../components/code-highlighter/demos/CodeBlockHeader';
import { fallbackHasCollapsibleFrames } from './fallbackCollapsible';
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
  const { source } = useCodeFallback(props);
  const mainSlug = props.slug ?? '';
  const mainVariant = props.initialVariant ?? 'Default';
  const id = React.useId();
  const checkboxId = `${id}-expand`;
  const firstFileName = props.fileNames?.[0];
  // Only flag the code collapsible (which reveals the Expand toggle via CSS)
  // when the fallback frames actually collapse — plain blocks have no toggle.
  const collapsible = fallbackHasCollapsibleFrames(source);

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
          <pre className={styles.codeBlock}>
            {/* `data-filename` lets `transformHtmlCodeBlock` / crawlers read the
                file name; the source is the code element's text content. */}
            <code data-filename={firstFileName} data-collapsible={collapsible ? '' : undefined}>
              {source ? hastToJsx(source) : null}
            </code>
          </pre>
        </div>
        {/* No-JS collapse toggle — the CSS `:checked` state drives the window. */}
        <input type="checkbox" id={checkboxId} className={styles.checkbox} />
        <label htmlFor={checkboxId} className={styles.toggle}>
          <span className={styles.expandLabel}>Expand</span>
          <span className={styles.collapseLabel}>Collapse</span>
        </label>
      </div>
    </div>
  );
  // @focus-end
}
