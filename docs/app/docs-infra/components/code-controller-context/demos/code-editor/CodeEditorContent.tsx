'use client';

import * as React from 'react';
import { useEditable } from 'use-editable';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useCode } from '@mui/internal-docs-infra/useCode';
import { CodeActionsMenu } from '../../../code-highlighter/demos/CodeActionsMenu';
import {
  CodeBlockHeader,
  CodeBlockHeaderLabel,
} from '../../../code-highlighter/demos/CodeBlockHeader';
import styles from './CodeEditorContent.module.css';

import '../../../code-highlighter/demos/syntax.css';

export function CodeEditorContent(props: ContentProps<object>) {
  // @focus-start @padding 1
  const preRef = React.useRef<HTMLPreElement | null>(null);
  const code = useCode(props, { preClassName: styles.codeBlock, preRef });

  const hasJsTransform = code.availableTransforms.includes('js');
  const isJsSelected = code.selectedTransform === 'js';
  const toggleJs = React.useCallback(
    (enabled: boolean) => {
      code.selectTransform(enabled ? 'js' : null);
    },
    [code],
  );

  const onInput = React.useCallback(
    (text: string) => {
      code.setSource?.(text);
    },
    [code],
  );

  useEditable(preRef, onInput, { indentation: 2 });

  return (
    <div className={styles.container}>
      <CodeBlockHeader
        roundedTop
        menu={
          <CodeActionsMenu
            inline
            onCopy={code.copy}
            fileUrl={code.selectedFileUrl}
            fileName={code.selectedFileName}
            jsTransform={hasJsTransform ? { enabled: isJsSelected, onToggle: toggleJs } : undefined}
          />
        }
      >
        <CodeBlockHeaderLabel>{code.selectedFileName}</CodeBlockHeaderLabel>
      </CodeBlockHeader>
      <div className={styles.code}>{code.selectedFile}</div>
    </div>
  );
  // @focus-end
}
