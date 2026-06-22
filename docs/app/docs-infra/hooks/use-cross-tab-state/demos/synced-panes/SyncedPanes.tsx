'use client';
import * as React from 'react';
import { useCrossTabState } from '@mui/internal-docs-infra/useCrossTabState';
import styles from './SyncedPanes.module.css';

function SyncedEditor({ label }: { label: string }) {
  // @focus-start @padding 1
  // Every editor sharing this key — both panes here, and any other tab of this page
  // — reads and writes the same value, so editing one updates the rest.
  const [text, setText] = useCrossTabState('use-cross-tab-state-demo', 'Edit me…');
  // @focus-end

  return (
    <label className={styles.pane}>
      <span className={styles.label}>{label}</span>
      <textarea
        className={styles.input}
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={4}
        aria-label={label}
      />
    </label>
  );
}

export function SyncedPanes() {
  return (
    <div className={styles.container}>
      <SyncedEditor label="Pane A" />
      <SyncedEditor label="Pane B" />
    </div>
  );
}
