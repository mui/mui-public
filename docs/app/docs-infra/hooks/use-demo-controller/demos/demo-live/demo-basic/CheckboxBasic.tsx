import * as React from 'react';
import { Checkbox } from '@/components/Checkbox';
import styles from './checkbox.module.css';

export default function CheckboxBasic() {
  return (
    <div>
      {/* @focus-start */}
      <Checkbox defaultChecked />
      <p className={styles.text}>Type Whatever You Want Below</p>
      {/* @focus-end */}
    </div>
  );
}
