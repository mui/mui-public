import * as React from 'react';
import styles from './DemoError.module.css';

export interface DemoErrorProps {
  /** The current error message, or `null`/`undefined` when the demo is clean. */
  error?: string | null;
}

/**
 * Basic error display for a demo preview. Shows the runtime error reported by the
 * live runner (via `useDemo().error`), or renders nothing when there is none.
 */
export function DemoError({ error }: DemoErrorProps) {
  if (!error) {
    return null;
  }

  return (
    <div role="alert" className={styles.error}>
      {error}
    </div>
  );
}
