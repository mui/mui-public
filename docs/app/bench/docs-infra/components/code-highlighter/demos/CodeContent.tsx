'use client';

import * as React from 'react';

import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useCode } from '@mui/internal-docs-infra/useCode';

import styles from './CodeContent.module.css';

import '@wooorm/starry-night/style/light';

export function CodeContent(props: ContentProps<{}>) {
  const code = useCode(props, { preClassName: styles.codeBlock });

  return <div className={styles.code}>{code.selectedFile}</div>;
}
