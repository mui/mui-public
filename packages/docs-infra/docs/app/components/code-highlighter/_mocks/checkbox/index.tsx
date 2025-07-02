import * as React from 'react';
import styles from './index.module.css';

export function Checkbox({ defaultChecked }: { defaultChecked?: boolean }) {
  return (
    <label className={styles.checkbox}>
      <input type="checkbox" defaultChecked={defaultChecked} />
      <span className={styles.checkmark}></span>
    </label>
  );
}
