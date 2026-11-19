'use client';

import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useCode } from '@mui/internal-docs-infra/useCode';
import styles from './SyntaxThemePreview.module.css';

export function PreviewContent(props: ContentProps<object>) {
  // @focus-start @padding 1
  const code = useCode(props, { preClassName: styles.pre });
  return code.selectedFile;
  // @focus-end
}
