'use client';
import * as React from 'react';
import { BrowserApproach } from './BrowserApproach';
import { HookApproach } from './HookApproach';
import styles from './Comparison.module.css';

type Mode = 'browser' | 'hook';

const modeQuality: Record<Mode, 'bad' | 'good'> = {
  browser: 'bad',
  hook: 'good',
};

const modeLabels: Record<Mode, string> = {
  browser: 'Without the hook',
  hook: 'With useScrollAnchor',
};

const modeBadges: Record<Mode, string> = {
  browser: 'Problem',
  hook: 'Fix',
};

const modeDescriptions: Record<Mode, string> = {
  browser:
    'Relies on the browser’s built-in overflow-anchor. The events you were already reading get pushed down off-screen as older history loads in above them.',
  hook: 'useScrollAnchor pins the topmost visible event before the layout change, so the events you were already reading stay exactly where they were.',
};

const approaches: Record<Mode, React.ComponentType<{ animate: boolean }>> = {
  browser: BrowserApproach,
  hook: HookApproach,
};

export function Comparison() {
  // @focus-start @padding 1
  const [mode, setMode] = React.useState<Mode>('browser');
  const [animate, setAnimate] = React.useState(true);

  const Approach = approaches[mode];
  // @focus-end

  return (
    <div className={styles.root} data-mode={mode}>
      <div className={styles.controls}>
        <fieldset className={styles.modePicker}>
          <legend className={styles.modeLegend}>Anchoring strategy</legend>
          {(Object.keys(modeLabels) as Mode[]).map((value) => (
            <label
              key={value}
              className={styles.modeOption}
              data-active={value === mode}
              data-quality={modeQuality[value]}
            >
              <input
                type="radio"
                name="anchor-mode"
                value={value}
                checked={value === mode}
                onChange={() => setMode(value)}
              />
              <span className={styles.modeBadge}>{modeBadges[value]}</span>
              <span>{modeLabels[value]}</span>
            </label>
          ))}
        </fieldset>
        <label className={styles.switch}>
          <input
            type="checkbox"
            checked={animate}
            onChange={(event) => setAnimate(event.target.checked)}
          />
          <span>Animate</span>
        </label>
      </div>

      <p className={styles.hint} data-quality={modeQuality[mode]}>
        {modeDescriptions[mode]}
      </p>

      <Approach key={mode} animate={animate} />
    </div>
  );
}
