import 'server-only';

import * as React from 'react';
import type { ContentLoadingProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import styles from './CodeContent.module.css';

import '@wooorm/starry-night/style/light';

export function CodeContentLoading(props: ContentLoadingProps<{}>) {
  return (
    <div>
      {/* @highlight-start @focus */}
      <div className={styles.code}>
        <pre className={styles.codeBlock}>{props.source}</pre>
      </div>
      {/* @highlight-end */}
    </div>
  );
}
