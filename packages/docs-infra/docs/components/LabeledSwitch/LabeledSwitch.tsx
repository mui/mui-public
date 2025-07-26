import * as React from 'react';
import { Toggle } from '@base-ui-components/react/toggle';
import { ToggleGroup } from '@base-ui-components/react/toggle-group';
import styles from './LabeledSwitch.module.css';

/**
 * A two-option switch with labels.
 * @param checked the currently selected value
 * @param onCheckedChange called when the value changes
 * @param labels to show for each option, e.g. { false: 'TS', true: 'JS' }
 * @param defaultChecked the initial value when the component mounts
 */
export function LabeledSwitch({
  checked,
  onCheckedChange,
  labels,
  defaultChecked,
}: {
  checked: boolean | undefined;
  onCheckedChange: (checked: boolean) => void;
  labels: { false: string; true: string };
  defaultChecked?: boolean;
}) {
  const handleChange = React.useCallback(
    (value: string[]) => {
      if (value.length === 0) {
        return;
      } else if (value.length === 1) {
        onCheckedChange(value[0] === 'true');
      } else {
        onCheckedChange(!checked);
      }
    },
    [checked, labels, onCheckedChange],
  );

  return (
    <ToggleGroup
      defaultValue={[defaultChecked ? 'true' : 'false']}
      onValueChange={handleChange}
      className={styles.root}
    >
      <span className={`${styles.indicator} ${checked ? styles.checked : ''}`} />
      <Toggle
        aria-label={labels.false}
        className={`${styles.segment} ${!checked ? styles.active : ''}`}
        value="false"
      >
        {labels.false}
      </Toggle>
      <Toggle
        aria-label={labels.true}
        value="true"
        className={`${styles.segment} ${checked ? styles.active : ''}`}
      >
        {labels.true}
      </Toggle>
    </ToggleGroup>
  );
}
