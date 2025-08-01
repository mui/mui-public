'use client';

import * as React from 'react';
import styles from './AsyncButton.module.css';

export function AsyncButton() {
  const [loading, setLoading] = React.useState(false);
  const [result, setResult] = React.useState('');

  const handleClick = async () => {
    setLoading(true);
    setResult('');

    // Simulate async operation
    await new Promise((resolve) => setTimeout(resolve, 2000));

    setResult('Operation completed!');
    setLoading(false);
  };

  return (
    <div className={styles.demoContainer}>
      <button onClick={handleClick} disabled={loading} className={styles.asyncButton}>
        {loading ? 'Loading...' : 'Start Async Operation'}
      </button>

      {result && <div className={styles.result}>{result}</div>}
    </div>
  );
}
