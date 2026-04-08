'use client';

import * as React from 'react';
import styles from './index.module.css';

type CheckboxProps = {
  defaultChecked: boolean;
  name?: string;
  className?: string;
  style?: React.CSSProperties;
};

// This component mainly serves as a mock for a Checkbox component used in demos.

export function Checkbox({ defaultChecked, name = 'checkbox', className, style }: CheckboxProps) {
  const [checked, setChecked] = React.useState(defaultChecked);
  const id = React.useId();
  const inputId = `${id}-${name}-input`;
  const onChange = React.useCallback(() => {
    setChecked((prev) => !prev);
  }, []);

  return (
    <label className={styles.checkbox} htmlFor={inputId}>
      <input
        id={inputId}
        type="checkbox"
        name={name}
        checked={checked}
        onChange={onChange}
        style={style}
      />
      <span className={[styles.checkmark, className].join(' ')}></span>
      <span className={styles['sr-only']}>Checkbox</span>
    </label>
  );
}
