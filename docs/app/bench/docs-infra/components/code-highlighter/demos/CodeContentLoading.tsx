import 'server-only';

import * as React from 'react';
import type { ContentLoadingProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import styles from './CodeContent.module.css';

import '@wooorm/starry-night/style/light';

export function CodeContentLoading(props: ContentLoadingProps<{}>) {
  return (
    <div>
      <div className={styles.code}>
        <pre className={styles.codeBlock}>{props.source}</pre>
      </div>
    </div>
  );
}
