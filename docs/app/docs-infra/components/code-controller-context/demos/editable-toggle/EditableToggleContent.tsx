'use client';

import * as React from 'react';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useCode } from '@mui/internal-docs-infra/useCode';
import {
  CodeBlockHeader,
  CodeBlockHeaderLabel,
} from '../../../code-highlighter/demos/CodeBlockHeader';
import styles from './EditableToggleContent.module.css';

import '../../../code-highlighter/demos/syntax.css';

export function EditableToggleContent(props: ContentProps<object>) {
  // @focus-start @padding 1
  const code = useCode(props, { preClassName: styles.codeBlock });

  return (
    <div className={styles.container}>
      <CodeBlockHeader
        roundedTop
        menu={
          // `setEditable` is defined only when a controller is in scope, so the toggle
          // renders only where editing is actually possible. While `code.editable` is
          // false the block stays read-only (no `contentEditable`, no engine warm).
          code.setEditable ? (
            <button
              type="button"
              className={styles.editToggle}
              onClick={() => code.setEditable?.(!code.editable)}
            >
              {code.editable ? 'Done' : 'Edit'}
            </button>
          ) : undefined
        }
      >
        <CodeBlockHeaderLabel>{code.selectedFileName}</CodeBlockHeaderLabel>
      </CodeBlockHeader>
      <div className={styles.code}>{code.selectedFile}</div>
    </div>
  );
  // @focus-end
}
