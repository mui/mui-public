import * as React from 'react';
import styles from './Switch.module.css';

/**
 * A two-option switch.
 * @param options  Array of { label, value } for each side
 * @param value    the currently selected value
 * @param onChange called with the new value when you click a segment
 */
export default function SegmentedSwitch({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: string | boolean }[];
  value: string | boolean;
  onChange: (value: string | boolean) => void;
}) {
  return (
    <div className={styles.wrapper}>
      {options.map(({ label, value: val }) => (
        <button
          key={String(val)}
          type="button"
          className={`${styles.segment} ${value === val ? styles.active : ''}`}
          onClick={() => onChange(val)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
