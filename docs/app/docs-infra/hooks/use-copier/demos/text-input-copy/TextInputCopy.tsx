'use client';
import * as React from 'react';
import { useCopier } from '@mui/internal-docs-infra/useCopier';
import styles from './TextInputCopy.module.css';

export function TextInputCopy() {
  const [text, setText] = React.useState('Hello, copy me!');
  const { copy, recentlySuccessful } = useCopier(() => text);

  return (
    <div className={styles.container}>
      <input
        type="text"
        value={text}
        onChange={(event) => setText(event.target.value)}
        className={styles.input}
        placeholder="Enter text to copy..."
      />
      <button type="button" onClick={copy} className={styles.button}>
        {recentlySuccessful ? '✓ Copied!' : 'Copy'}
      </button>
    </div>
  );
}
