import * as React from 'react';
import { Checkbox } from '@/components/Checkbox';
import styles from './CheckboxRed.module.css';

export function CheckboxRed() {
  return (
    // @focus
    <Checkbox className={styles.root} defaultChecked />
  );
}
