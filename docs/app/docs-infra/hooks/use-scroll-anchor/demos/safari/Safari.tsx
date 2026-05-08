'use client';
import * as React from 'react';
import { HookApproach } from './HookApproach';
import { SafariApproach } from './SafariApproach';
import styles from './Safari.module.css';

type Mode = 'safari' | 'hook';

const modeQuality: Record<Mode, 'bad' | 'good'> = {
  safari: 'bad',
  hook: 'good',
};

const modeLabels: Record<Mode, string> = {
  safari: 'Safari behaviour',
  hook: 'useScrollAnchor hook',
};

const modeBadges: Record<Mode, string> = {
  safari: 'Problem',
  hook: 'Fix',
};

const modeDescriptions: Record<Mode, string> = {
  safari:
    'Safari has no native CSS scroll anchoring. Each older message that streams in pushes the rest of the conversation down — what the reader was looking at slides out of view.',
  hook: 'useScrollAnchor pins the topmost visible message before each prepend, so the conversation the reader is following stays put on every browser.',
};

const approaches: Record<Mode, React.ComponentType> = {
  safari: SafariApproach,
  hook: HookApproach,
};

export function Safari() {
  // @focus-start @padding 1
  const [mode, setMode] = React.useState<Mode>('safari');

  const Approach = approaches[mode];

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
                name="safari-mode"
                value={value}
                checked={value === mode}
                onChange={() => setMode(value)}
              />
              <span className={styles.modeBadge}>{modeBadges[value]}</span>
              <span>{modeLabels[value]}</span>
            </label>
          ))}
        </fieldset>
      </div>

      <p className={styles.hint} data-quality={modeQuality[mode]}>
        {modeDescriptions[mode]}
      </p>

      <Approach key={mode} />
    </div>
  );
  // @focus-end
}
