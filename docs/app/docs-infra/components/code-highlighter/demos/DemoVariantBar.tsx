import * as React from 'react';
import { Select } from '@/components/Select';
import styles from './DemoVariantBar.module.css';

export interface DemoVariantBarProps {
  variants: { label: string; value: string }[];
  selectedVariant?: string;
  onVariantChange?: (value: string | null, anchorEl: HTMLElement | null) => void;
  disabled?: boolean;
}

/**
 * Variant selector pinned to the top-left of a demo section.
 * Renders nothing when there are fewer than two variants.
 */
export function DemoVariantBar({
  variants,
  selectedVariant,
  onVariantChange,
  disabled,
}: DemoVariantBarProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  const handleVariantChange = React.useCallback(
    (value: string | null) => {
      onVariantChange?.(value, rootRef.current);
    },
    [onVariantChange],
  );

  // @focus-start @padding 1
  if (variants.length < 2) {
    return null;
  }
  return (
    <div ref={rootRef} className={styles.variantBar}>
      <Select
        items={variants}
        value={selectedVariant}
        onValueChange={handleVariantChange}
        disabled={disabled}
        className={styles.variantSelect}
      />
    </div>
  );
  // @focus-end
}
