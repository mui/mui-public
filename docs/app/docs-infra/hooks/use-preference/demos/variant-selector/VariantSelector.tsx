'use client';
import * as React from 'react';
import { usePreference } from '@mui/internal-docs-infra/usePreference';
import styles from './VariantSelector.module.css';

export function VariantSelector() {
  const variants = ['contained', 'outlined', 'text'];
  const [variant, setVariant] = usePreference('variant', variants, () => 'contained');

  return (
    <div className={styles.container}>
      <div className={styles.controls}>
        <div className={styles.label}>Button Variant:</div>
        <div className={styles.buttonGroup}>
          {variants.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setVariant(option)}
              className={variant === option ? styles.buttonSelected : styles.button}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.preview}>
        <p className={styles.previewText}>Selected: {variant}</p>
        <p className={styles.hint}>Your preference is saved across sessions</p>
      </div>
    </div>
  );
}
