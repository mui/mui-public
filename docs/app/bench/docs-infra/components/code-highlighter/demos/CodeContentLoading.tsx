import 'server-only';

import * as React from 'react';
import type { ContentLoadingProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import styles from './CodeContent.module.css';

import '../../../../../docs-infra/components/code-highlighter/demos/syntax.css';

export function CodeContentLoading(_props: ContentLoadingProps<{}>) {
  return (
    <div>
      {/* @focus-start */}
      <div className={styles.code}>
        <pre className={styles.codeBlock} />
      </div>
      {/* @focus-end */}
    </div>
  );
}
