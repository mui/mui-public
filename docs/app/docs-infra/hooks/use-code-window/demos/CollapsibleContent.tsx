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
  const { containerRef, toggleRef, anchorScroll } = useCodeWindow<HTMLLabelElement>();
  const { containerRef: transformAnchorRef, anchorScroll: anchorTransformScroll } =
    useScrollAnchor<HTMLDivElement>();
  const code = useCode(props, {
    preClassName: styles.codeBlock,
    transformDelay: 350,
    transformLayoutShift: 'focus',
    variantSwapDelay: 350,
    variantLayoutShift: 'focus',
    // Keyboard-driven expansion (caret navigates past the visible top/bottom)
    // anchors the scroll just like clicking the expand toggle does.
    onExpand: () => anchorScroll('expand'),
  });
  const id = React.useId();
  const checkboxId = `${id}-expand`;
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
        {/* Visually hidden checkbox provides no-JS toggle state via CSS :checked.
            It is *controlled* by `code.expanded` so JS-driven expansion — e.g.
            arrow-key navigation past the visible region calling `code.expand()`
            — reveals the frames too, not just a direct click. Without this the
            checkbox and the engine's expand state drift apart: keyboard expand
            would unlock caret bounds while the frames stayed hidden. */}
        <input
          type="checkbox"
          id={checkboxId}
          className={styles.checkbox}
          checked={code.expanded}
          onFocus={blurPointerFocus}
          onChange={(event) => {
            code.setExpanded(event.target.checked);
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
