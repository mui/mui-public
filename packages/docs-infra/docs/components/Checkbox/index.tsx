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
  const onChange = React.useCallback(() => {
    setChecked((prev) => !prev);
  }, []);

  return (
    <label className={styles.checkbox} htmlFor={`${name}-input`}>
      <input
        id={`${name}-input`}
        type="checkbox"
        name={name}
        checked={checked}
        onChange={onChange}
        className={className}
        style={style}
      />
      <span className={styles.checkmark}></span>
      <span className="sr-only">Checkbox</span>
    </label>
  );
}
