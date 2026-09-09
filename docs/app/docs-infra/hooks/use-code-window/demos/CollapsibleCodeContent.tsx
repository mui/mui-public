'use client';

import * as React from 'react';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useCode } from '@mui/internal-docs-infra/useCode';
import { useCodeWindow } from '@mui/internal-docs-infra/useCodeWindow';
import { CodeActionsMenu } from '../../../components/code-highlighter/demos/CodeActionsMenu';
import { CodeBlockHeader } from '../../../components/code-highlighter/demos/CodeBlockHeader';
import { CodeSource } from '../../../components/code-highlighter/demos/CodeSource';
import styles from './CollapsibleCodeContent.module.css';

export function CollapsibleCodeContent(props: ContentProps<object>) {
  // @focus-start @padding 1
  const { containerRef, toggleRef, anchorScroll } = useCodeWindow<HTMLLabelElement>();
  const code = useCode(props, {
    preClassName: styles.codeBlock,
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
  const toggleJs = (enabled: boolean) => code.selectTransform(enabled ? 'js' : null);

  return (
    <div>
      {code.allFilesSlugs.map(({ slug }) => (
        <span key={slug} id={slug} className={styles.fileRefs} />
      ))}
      <div ref={containerRef} className={styles.container}>
        <CodeBlockHeader
          roundedTop
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
        <CodeSource className={styles.code}>{code.selectedFile}</CodeSource>
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
