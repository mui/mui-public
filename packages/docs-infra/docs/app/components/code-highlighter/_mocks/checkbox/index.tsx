import * as React from 'react';
import styles from './index.module.css';

type CheckboxProps = {
  defaultChecked: boolean;
};

export function Checkbox({ defaultChecked }: CheckboxProps) {
  return (
    <label className={styles.checkbox}>
      <input type="checkbox" defaultChecked={defaultChecked} />
      <span className={styles.checkmark}></span>
    </label>
  );
}
