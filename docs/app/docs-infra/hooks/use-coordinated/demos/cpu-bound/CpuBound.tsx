'use client';
import * as React from 'react';
import { useCoordinated } from '@mui/internal-docs-infra/useCoordinated';
import styles from './CpuBound.module.css';

type Theme = 'light' | 'dark' | 'high-contrast';
type Mode = 'uncoordinated' | 'coordinated';

const THEMES: Theme[] = ['light', 'dark', 'high-contrast'];

const PANEL_NAMES = ['Module A', 'Module B', 'Module C', 'Module D'] as const;
type PanelName = (typeof PANEL_NAMES)[number];

// Per-panel "work" — different sizes so the originator block lasts
// noticeably longer than the rest in the uncoordinated case. Numbers
// are deliberately large enough to be felt as a hitch but small
// enough that the demo never hangs the page for long.
const WORK_BUDGET_MS: Record<PanelName, number> = {
  'Module A': 80,
  'Module B': 220,
  'Module C': 140,
  'Module D': 320,
};

// Busy-loop synchronously for `budgetMs`. This is the worst-case
// shape of CPU-bound preference work: highlighting many code blocks,
// laying out a virtualized tree, etc. Run inline it pegs the main
// thread; run inside a yielding preload it never blocks paint.
function burnSync(budgetMs: number): string {
  const start = performance.now();
  // The work output: a fake "checksum" of the simulated computation.
  let checksum = 0;
  while (performance.now() - start < budgetMs) {
    // Trivially non-optimizable arithmetic so the JIT can't elide it.
    checksum = Math.trunc(checksum + Math.sin(checksum + 1) * 1e6);
  }
  return `0x${Math.abs(checksum).toString(16).padStart(8, '0')}`;
}

// Chunked variant: same total CPU budget but yields to the event
// loop between slices so React's layout passes, button hover, and
// the toolbar's pending state still feel responsive.
async function burnChunked(budgetMs: number, signal: AbortSignal, sliceMs = 16): Promise<string> {
  const start = performance.now();
  let checksum = 0;
  while (performance.now() - start < budgetMs) {
    if (signal.aborted) {
      throw new Error('aborted');
    }
    const sliceStart = performance.now();
    while (performance.now() - sliceStart < sliceMs && performance.now() - start < budgetMs) {
      checksum = Math.trunc(checksum + Math.sin(checksum + 1) * 1e6);
    }
    // Hand the main thread back so paint, input, and other peers
    // can interleave.
    // eslint-disable-next-line no-await-in-loop
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  return `0x${Math.abs(checksum).toString(16).padStart(8, '0')}`;
}

const MODE_QUALITY: Record<Mode, 'bad' | 'good'> = {
  uncoordinated: 'bad',
  coordinated: 'good',
};

const MODE_LABELS: Record<Mode, string> = {
  uncoordinated: 'Without useCoordinated',
  coordinated: 'With useCoordinated',
};

const MODE_BADGES: Record<Mode, string> = {
  uncoordinated: 'Problem',
  coordinated: 'Fix',
};

const MODE_DESCRIPTIONS: Record<Mode, string> = {
  uncoordinated:
    'The new theme commits the moment you click, so every panel runs its sync CPU work in the same React render. The button stays pressed-down, the toolbar never updates its highlighted theme, and the page is frozen for ~750 ms before anything paints. Try hovering another button mid-burn — no feedback.',
  coordinated:
    'The toolbar flips pendingValue immediately so the new theme highlights in the same frame as the click. Each panel runs the same total work inside a yielding preload, the panels show a loading badge, and the four heavy renders all land together once the slowest one finishes — without ever blocking the main thread for more than one slice.',
};

function PanelChrome({
  name,
  theme,
  checksum,
  loading,
  pendingHint,
}: {
  name: PanelName;
  theme: Theme;
  checksum: string;
  loading: boolean;
  pendingHint?: string | null;
}) {
  return (
    <div className={styles.panel} data-theme={theme} data-loading={loading || undefined}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>{name}</span>
        <span className={styles.panelBudget}>{WORK_BUDGET_MS[name]} ms work</span>
      </div>
      {loading ? <span className={styles.panelBadge}>Computing…</span> : null}
      <p className={styles.panelMeta}>
        Theme: <strong>{theme}</strong>
        {pendingHint ? <span className={styles.panelPending}>{pendingHint}</span> : null}
      </p>
      <p className={styles.panelChecksum}>checksum: {checksum}</p>
    </div>
  );
}

// ---------- "Problem": CPU work in render ----------
// The panel runs the sync busy-loop in a layout effect on every
// theme change. React commits the state, then the layout pass
// blocks until all four panels finish their inline work — and
// during that block the toolbar and button state can't repaint.
// (We use a layout effect rather than `useMemo` during render so
// the work never runs on the server, where it would both waste CPU
// and produce a hydration-mismatching checksum.)
function UncoordinatedPanel({ name, theme }: { name: PanelName; theme: Theme }) {
  const [checksum, setChecksum] = React.useState<string>('0x00000000');
  React.useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: this demo illustrates CPU work blocking the main thread post-commit; running it during render (useMemo) would execute on the server and cause a hydration mismatch (see comment above)
    setChecksum(burnSync(WORK_BUDGET_MS[name]));
  }, [name, theme]);
  return <PanelChrome name={name} theme={theme} checksum={checksum} loading={false} />;
}

// ---------- "Fix": CPU work in a yielding preload ----------
function CoordinatedPanel({
  name,
  theme,
  onChangeTheme,
}: {
  name: PanelName;
  theme: Theme;
  onChangeTheme: (next: Theme) => void;
}) {
  const tuple = React.useMemo<[Theme, (next: Theme) => void]>(
    () => [theme, onChangeTheme],
    [theme, onChangeTheme],
  );
  const [checksum, setChecksum] = React.useState<string>(
    () =>
      // Initial paint isn't part of the demo — seed with a placeholder
      // so we don't burn CPU on first mount.
      '0x00000000',
  );

  // @focus-start @padding 1
  const [visibleTheme, , extras] = useCoordinated<Theme, string>(tuple, {
    channelKey: 'cpu-bound-demo',
    peerId: `coord-${name}`,
    causesLayoutShift: () => true,
    // The CPU work runs inside `preload`, chunked so it yields back
    // to the event loop between slices. The toolbar (and every
    // pendingValue indicator) can repaint while the work continues;
    // the coordinated commit installs the precomputed result
    // atomically once every peer finishes.
    preload: (_target, signal) => burnChunked(WORK_BUDGET_MS[name], signal),
    // The "Computing…" badge IS the visible animation for this demo
    // — we want it on screen while the chunked preload runs.
    // Default (`false`) would hold the badge until preload settled,
    // hiding the very state we're trying to illustrate.
    animateDuringPreload: true,
    onCommit: (_target, preloaded) => {
      if (preloaded) {
        setChecksum(preloaded);
      }
    },
    ultimateTimeoutMs: 3000,
    gracePeriodMs: 250,
  });
  // @focus-end

  return (
    <PanelChrome
      name={name}
      theme={visibleTheme}
      checksum={checksum}
      loading={extras.isCoordinating}
      pendingHint={extras.pendingValue !== visibleTheme ? `→ ${extras.pendingValue}` : null}
    />
  );
}

function Panels({
  mode,
  theme,
  onChangeTheme,
}: {
  mode: Mode;
  theme: Theme;
  onChangeTheme: (next: Theme) => void;
}) {
  if (mode === 'uncoordinated') {
    return (
      <div className={styles.panels}>
        {PANEL_NAMES.map((name) => (
          <UncoordinatedPanel key={name} name={name} theme={theme} />
        ))}
      </div>
    );
  }
  return (
    <div className={styles.panels}>
      {PANEL_NAMES.map((name) => (
        <CoordinatedPanel key={name} name={name} theme={theme} onChangeTheme={onChangeTheme} />
      ))}
    </div>
  );
}

export function CpuBound() {
  const [mode, setMode] = React.useState<Mode>('uncoordinated');
  const [theme, setTheme] = React.useState<Theme>('light');

  return (
    <div className={styles.root} data-mode={mode}>
      <div className={styles.controls}>
        <fieldset className={styles.modePicker}>
          <legend className={styles.modeLegend}>Coordination mode</legend>
          {(Object.keys(MODE_LABELS) as Mode[]).map((value) => (
            <label
              key={value}
              className={styles.modeOption}
              data-active={value === mode}
              data-quality={MODE_QUALITY[value]}
            >
              <input
                type="radio"
                name="cpu-bound-mode"
                value={value}
                checked={value === mode}
                onChange={() => setMode(value)}
              />
              <span className={styles.modeBadge}>{MODE_BADGES[value]}</span>
              <span>{MODE_LABELS[value]}</span>
            </label>
          ))}
        </fieldset>
        <div className={styles.themePicker}>
          <span className={styles.themeLabel}>Theme:</span>
          {THEMES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setTheme(option)}
              className={
                theme === option
                  ? `${styles.themeButton} ${styles.themeButtonSelected}`
                  : styles.themeButton
              }
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <p className={styles.hint} data-quality={MODE_QUALITY[mode]}>
        {MODE_DESCRIPTIONS[mode]}
      </p>

      <Panels key={mode} mode={mode} theme={theme} onChangeTheme={setTheme} />
    </div>
  );
}
