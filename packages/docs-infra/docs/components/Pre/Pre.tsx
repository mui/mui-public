import * as React from 'react';
import styles from './Pre.module.css';

export function Pre({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.root}>
      <pre>{children}</pre>
    </div>
  );
}
