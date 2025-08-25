import * as React from 'react';
import { Select as SelectParts } from '@base-ui-components/react/select';
import styles from './Select.module.css';

export interface Props {
  items: { label: string; value: string }[];
  value?: string;
  onValueChange?: (value: string) => void;
}

export default function Select({ items, value, onValueChange }: Props) {
  return (
    <SelectParts.Root items={items} value={value} onValueChange={onValueChange}>
      <SelectParts.Trigger className={styles.Select}>
        <SelectParts.Value />
        <SelectParts.Icon className={styles.SelectIcon}>
          <ChevronUpDownIcon />
        </SelectParts.Icon>
      </SelectParts.Trigger>
      <SelectParts.Portal>
        <SelectParts.Positioner className={styles.Positioner} sideOffset={8}>
          <SelectParts.ScrollUpArrow className={styles.ScrollArrow} />
          <SelectParts.Popup className={styles.Popup}>
            {items.map(({ label, value }) => (
              <SelectParts.Item key={label} value={value} className={styles.Item}>
                <SelectParts.ItemIndicator className={styles.ItemIndicator}>
                  <CheckIcon className={styles.ItemIndicatorIcon} />
                </SelectParts.ItemIndicator>
                <SelectParts.ItemText className={styles.ItemText}>{label}</SelectParts.ItemText>
              </SelectParts.Item>
            ))}
          </SelectParts.Popup>
          <SelectParts.ScrollDownArrow className={styles.ScrollArrow} />
        </SelectParts.Positioner>
      </SelectParts.Portal>
    </SelectParts.Root>
  );
}

function ChevronUpDownIcon(props: React.ComponentProps<'svg'>) {
  return (
    <svg
      width="8"
      height="12"
      viewBox="0 0 8 12"
      fill="none"
      stroke="currentcolor"
      strokeWidth="1.5"
      {...props}
    >
      <path d="M0.5 4.5L4 1.5L7.5 4.5" />
      <path d="M0.5 7.5L4 10.5L7.5 7.5" />
    </svg>
  );
}

function CheckIcon(props: React.ComponentProps<'svg'>) {
  return (
    <svg fill="currentcolor" width="10" height="10" viewBox="0 0 10 10" {...props}>
      <path d="M9.1603 1.12218C9.50684 1.34873 9.60427 1.81354 9.37792 2.16038L5.13603 8.66012C5.01614 8.8438 4.82192 8.96576 4.60451 8.99384C4.3871 9.02194 4.1683 8.95335 4.00574 8.80615L1.24664 6.30769C0.939709 6.02975 0.916013 5.55541 1.19372 5.24822C1.47142 4.94102 1.94536 4.91731 2.2523 5.19524L4.36085 7.10461L8.12299 1.33999C8.34934 0.993152 8.81376 0.895638 9.1603 1.12218Z" />
    </svg>
  );
}
