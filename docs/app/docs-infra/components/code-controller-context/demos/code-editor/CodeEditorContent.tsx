'use client';

import * as React from 'react';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useCode } from '@mui/internal-docs-infra/useCode';
import { useScrollAnchor } from '@mui/internal-docs-infra/useScrollAnchor';
import { CodeActionsMenu } from '../../../code-highlighter/demos/CodeActionsMenu';
import {
  CodeBlockHeader,
  CodeBlockHeaderLabel,
} from '../../../code-highlighter/demos/CodeBlockHeader';
import { CodeSource } from '../../../code-highlighter/demos/CodeSource';
import styles from './CodeEditorContent.module.css';

export function CodeEditorContent(props: ContentProps<object>) {
  const code = useCode(props, {
    preClassName: styles.codeBlock,
    transformDelay: 350,
    variantSwapDelay: 350,
  });

  // Scroll-anchor session for the JS/TS transform swap. Keeps the toggle
  // (or the action-menu trigger that fronts it) pinned under the user's
  // pointer while the code height changes during the swap.
  const { containerRef: transformAnchorRef, anchorScroll: anchorTransformScroll } =
    useScrollAnchor<HTMLDivElement>();

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

  return (
    <div>
      {code.allFilesSlugs.map(({ slug }) => (
        <span key={slug} id={slug} className={styles.fileRefs} />
      ))}
      <div ref={transformAnchorRef} className={styles.container}>
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
              onReset={code.reset}
              jsTransform={
                hasJsTransform ? { enabled: isJsSelected, onToggle: toggleJs } : undefined
              }
            />
          }
        >
          <CodeBlockHeaderLabel>{code.selectedFileName}</CodeBlockHeaderLabel>
        </CodeBlockHeader>
        <CodeSource className={styles.code}>{code.selectedFile}</CodeSource>
      </div>
    </div>
  );
  // @focus-end
}
