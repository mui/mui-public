import * as React from 'react';
import { Checkbox } from '@/components/Checkbox';
import styles from './styles.module.css';

export function CheckboxBasic() {
  return (
    // @focus
    <Checkbox className={styles.green} defaultChecked />
  );
}
