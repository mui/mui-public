'use client';

import * as React from 'react';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useCode } from '@mui/internal-docs-infra/useCode';
import { useCodeWindow } from '@mui/internal-docs-infra/useCodeWindow';
import { useScrollAnchor } from '@mui/internal-docs-infra/useScrollAnchor';
import { CodeActionsMenu } from '../../../components/code-highlighter/demos/CodeActionsMenu';
import { CodeBlockHeader } from '../../../components/code-highlighter/demos/CodeBlockHeader';
import styles from './CollapsibleContent.module.css';

import '../../../components/code-highlighter/demos/syntax.css';

export function CollapsibleContent(props: ContentProps<object>) {
  // @focus-start @padding 1
  const code = useCode(props, {
    preClassName: styles.codeBlock,
    transformDelay: 350,
    variantSwapDelay: 350,
  });
  const id = React.useId();
  const checkboxId = `${id}-expand`;
  const { containerRef, toggleRef, anchorScroll } = useCodeWindow<HTMLLabelElement>();
  const { containerRef: transformAnchorRef, anchorScroll: anchorTransformScroll } =
    useScrollAnchor<HTMLDivElement>();
  const blurPointerFocus = React.useCallback((event: React.FocusEvent<HTMLInputElement>) => {
    if (!event.currentTarget.matches(':focus-visible')) {
      event.currentTarget.blur();
    }
  }, []);

  const hasJsTransform = code.availableTransforms.includes('js');
  const isJsSelected = code.selectedTransform === 'js';
  const toggleJs = React.useCallback(
    (enabled: boolean, anchorEl: HTMLElement | null) => {
      if (anchorEl) {
        anchorTransformScroll(anchorEl, 700);
      }
      code.selectTransform(enabled ? 'js' : null);
    },
    [code, anchorTransformScroll],
  );

  const setContainerRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node;
      transformAnchorRef.current = node;
    },
    [containerRef, transformAnchorRef],
  );

  return (
    <div>
      {code.allFilesSlugs.map(({ slug }) => (
        <span key={slug} id={slug} className={styles.fileRefs} />
      ))}
      <div ref={setContainerRef} className={styles.container}>
        <CodeBlockHeader
          roundedTop
          pending={code.pendingTransform}
          menu={
            <CodeActionsMenu
              inline
              onCopy={code.copy}
              fileUrl={code.selectedFileUrl}
              fileName={code.selectedFileName}
              fileSlug={code.selectedFileSlug}
              jsTransform={
                hasJsTransform ? { enabled: isJsSelected, onToggle: toggleJs } : undefined
              }
            />
          }
        />
        <div className={styles.code}>{code.selectedFile}</div>
        {/* Visually hidden checkbox provides no-JS toggle state via CSS :checked */}
        <input
          type="checkbox"
          id={checkboxId}
          className={styles.checkbox}
          onFocus={blurPointerFocus}
          onChange={(event) => {
            anchorScroll(event.target.checked ? 'expand' : 'collapse');
          }}
        />
        <label ref={toggleRef} htmlFor={checkboxId} className={styles.toggle}>
          <span className={styles.expandLabel}>Expand</span>
          <span className={styles.collapseLabel}>Collapse</span>
        </label>
      </div>
    </div>
  );
  // @focus-end
}
