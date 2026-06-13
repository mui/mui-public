'use client';
import * as React from 'react';
import { useCoordinated } from '@mui/internal-docs-infra/useCoordinated';
import styles from './CascadingLoads.module.css';

type Density = 'compact' | 'comfortable' | 'spacious';
type Sort = 'asc' | 'desc';
type Preference = { density: Density; sort: Sort };
type Mode = 'uncoordinated' | 'coordinated';

const DENSITIES: Density[] = ['compact', 'comfortable', 'spacious'];
const SORTS: { value: Sort; label: string }[] = [
  { value: 'asc', label: 'A → Z' },
  { value: 'desc', label: 'Z → A' },
];

// Same data set rendered at three densities. Line count differs per
// density so card heights change when density flips — but only when
// density flips. Re-sorting a card never changes its height; that's
// what `causesLayoutShift` is going to lean on below.
const PANELS = {
  Search: {
    compact: ['12 results'],
    comfortable: ['12 results', 'Sorted by relevance', 'Filtered: docs only'],
    spacious: [
      '12 results',
      'Sorted by relevance',
      'Filtered: docs only',
      'Last refreshed: just now',
      'Tip: press / to jump back to the search box',
    ],
  },
  Inbox: {
    compact: ['3 unread'],
    comfortable: ['3 unread', '1 mention', 'Snoozed: 2'],
    spacious: [
      '3 unread',
      '1 mention',
      'Snoozed: 2',
      'You replied within 2h on average this week',
      'Drafts auto-saved: 4',
    ],
  },
  Activity: {
    compact: ['5 events'],
    comfortable: ['5 events', '2 reviews requested', 'No failing checks'],
    spacious: [
      '5 events',
      '2 reviews requested',
      'No failing checks',
      'Your streak: 7 days',
      'Most active repo: docs-infra',
      'Quietest day this week: Wednesday',
    ],
  },
} as const;

type PanelName = keyof typeof PANELS;
const PANEL_NAMES: PanelName[] = ['Search', 'Inbox', 'Activity'];

// Wildly varied latencies make the difference between cascading and
// coordinated commits obvious. Click density and you can watch each
// strategy play out for several seconds.
const FETCH_DELAYS: Record<PanelName, number> = {
  Search: 200,
  Inbox: 700,
  Activity: 1500,
};

function resolveLines(panel: PanelName, preference: Preference): readonly string[] {
  const base = PANELS[panel][preference.density];
  return preference.sort === 'asc' ? base : [...base].reverse();
}

function fetchLines(
  panel: PanelName,
  preference: Preference,
  signal: AbortSignal,
): Promise<readonly string[]> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => resolve(resolveLines(panel, preference)), FETCH_DELAYS[panel]);
    signal.addEventListener('abort', () => {
      clearTimeout(id);
      reject(new Error('aborted'));
    });
  });
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
    'Each card fetches and commits independently. Sort changes look ragged but harmless. Density changes are visibly bad — the page jolts three times per click as heights flip in a cascade.',
  coordinated:
    'All three cards share a channel. The barrier only engages when the new value would change layout: density flips wait for the slowest peer and land together, but sort flips commit eagerly per peer because nothing reflows.',
};

function CardChrome({
  panel,
  visiblePreference,
  lines,
  loading,
  pendingHint,
}: {
  panel: PanelName;
  visiblePreference: Preference;
  lines: readonly string[];
  loading: boolean;
  pendingHint?: string | null;
}) {
  return (
    <div className={styles.card} data-loading={loading || undefined}>
      <div className={styles.cardHeader}>
        <span className={styles.cardTitle}>{panel}</span>
        <span className={styles.cardLatency}>{FETCH_DELAYS[panel]} ms fetch</span>
      </div>
      {loading ? <span className={styles.cardBadge}>Loading…</span> : null}
      <p className={styles.cardDensity}>
        Density: <strong>{visiblePreference.density}</strong>, sort:{' '}
        <strong>{visiblePreference.sort === 'asc' ? 'A→Z' : 'Z→A'}</strong>
        {pendingHint ? <span className={styles.cardPending}>{pendingHint}</span> : null}
      </p>
      <ul className={styles.cardLines}>
        {lines.map((line) => (
          <li key={`${panel}-${line}`}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

function describePending(current: Preference, target: Preference): string | null {
  if (current.density !== target.density && current.sort !== target.sort) {
    return `→ ${target.density}, ${target.sort === 'asc' ? 'A→Z' : 'Z→A'}`;
  }
  if (current.density !== target.density) {
    return `→ ${target.density}`;
  }
  if (current.sort !== target.sort) {
    return `→ ${target.sort === 'asc' ? 'A→Z' : 'Z→A'}`;
  }
  return null;
}

// ---------- "Problem": no coordination ----------
function UncoordinatedCard({ panel, preference }: { panel: PanelName; preference: Preference }) {
  const [lines, setLines] = React.useState<readonly string[]>(() =>
    resolveLines(panel, preference),
  );
  const [visiblePreference, setVisiblePreference] = React.useState<Preference>(preference);

  // Derived during render rather than tracked in effect state: it is
  // exactly the same guard the effect uses below, and it stays in sync
  // 1:1 across every transition (initial match, preference change,
  // fetch resolve which sets `visiblePreference = preference`, and
  // abort which leaves `preference !== visiblePreference`).
  const loading =
    preference.density !== visiblePreference.density || preference.sort !== visiblePreference.sort;

  React.useEffect(() => {
    if (
      preference.density === visiblePreference.density &&
      preference.sort === visiblePreference.sort
    ) {
      return undefined;
    }
    const controller = new AbortController();
    fetchLines(panel, preference, controller.signal).then(
      (next) => {
        setLines(next);
        setVisiblePreference(preference);
      },
      () => {
        // Aborted by the next change.
      },
    );
    return () => controller.abort();
  }, [panel, preference, visiblePreference]);

  return (
    <CardChrome
      panel={panel}
      visiblePreference={visiblePreference}
      lines={lines}
      loading={loading}
      pendingHint={describePending(visiblePreference, preference)}
    />
  );
}

// ---------- "Fix": coordinated ----------
function CoordinatedCard({
  panel,
  preference,
  onChangePreference,
}: {
  panel: PanelName;
  preference: Preference;
  onChangePreference: (next: Preference) => void;
}) {
  const tuple = React.useMemo<[Preference, (next: Preference) => void]>(
    () => [preference, onChangePreference],
    [preference, onChangePreference],
  );
  const [lines, setLines] = React.useState<readonly string[]>(() =>
    resolveLines(panel, preference),
  );
  // Track the most-recently committed density so causesLayoutShift
  // can compare target vs current without depending on stale closure
  // state. The hook stores the option in a ref, so this ref read
  // always sees the latest committed density.
  const lastCommittedDensityRef = React.useRef<Density>(preference.density);

  // @focus-start @padding 1
  const [visiblePreference, , extras] = useCoordinated<Preference, readonly string[]>(tuple, {
    channelKey: 'cascading-loads-demo',
    peerId: `coord-${panel}`,
    // The whole point of this demo: only ask peers to wait when the
    // transition actually changes layout. Sort flips render the same
    // number of lines at the same density, so they skip the barrier
    // and commit as soon as each peer's own preload resolves.
    causesLayoutShift: (target) => target.density !== lastCommittedDensityRef.current,
    preload: (target, signal) => fetchLines(panel, target, signal),
    // The preload is an I/O fetch — overlap the card's loading
    // indicator with the network roundtrip rather than waiting for
    // it to finish.
    animateDuringPreload: true,
    // The lazy commit itself is cheap (a `setLines` call), so skip
    // the `requestIdleCallback` defer — each panel's swap should
    // land as soon as its own fetch resolves, not cluster near the
    // slowest peer's settle.
    lazyCommitPriority: 'normal',
    onCommit: (target, preloaded) => {
      lastCommittedDensityRef.current = target.density;
      if (preloaded) {
        setLines(preloaded);
      }
    },
    // Long enough to absorb the 1500 ms slow peer.
    ultimateTimeoutMs: 4000,
    gracePeriodMs: 1500,
  });
  // @focus-end

  return (
    <CardChrome
      panel={panel}
      visiblePreference={visiblePreference}
      lines={lines}
      loading={extras.isCoordinating}
      pendingHint={describePending(visiblePreference, extras.pendingValue)}
    />
  );
}

function Cards({
  mode,
  preference,
  onChangePreference,
}: {
  mode: Mode;
  preference: Preference;
  onChangePreference: (next: Preference) => void;
}) {
  if (mode === 'uncoordinated') {
    return (
      <div className={styles.cards}>
        {PANEL_NAMES.map((panel) => (
          <UncoordinatedCard key={panel} panel={panel} preference={preference} />
        ))}
      </div>
    );
  }
  return (
    <div className={styles.cards}>
      {PANEL_NAMES.map((panel) => (
        <CoordinatedCard
          key={panel}
          panel={panel}
          preference={preference}
          onChangePreference={onChangePreference}
        />
      ))}
    </div>
  );
}

export function CascadingLoads() {
  const [mode, setMode] = React.useState<Mode>('uncoordinated');
  const [preference, setPreference] = React.useState<Preference>({
    density: 'compact',
    sort: 'asc',
  });

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
                name="cascading-loads-mode"
                value={value}
                checked={value === mode}
                onChange={() => setMode(value)}
              />
              <span className={styles.modeBadge}>{MODE_BADGES[value]}</span>
              <span>{MODE_LABELS[value]}</span>
            </label>
          ))}
        </fieldset>
      </div>

      <div className={styles.preferenceBar}>
        <div className={styles.preferenceGroup} data-shift="yes">
          <span className={styles.preferenceLabel}>
            Density <em>(causes layout shift)</em>
          </span>
          {DENSITIES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setPreference((prev) => ({ ...prev, density: option }))}
              className={
                preference.density === option
                  ? `${styles.densityButton} ${styles.densityButtonSelected}`
                  : styles.densityButton
              }
            >
              {option}
            </button>
          ))}
        </div>
        <div className={styles.preferenceGroup} data-shift="no">
          <span className={styles.preferenceLabel}>
            Sort <em>(no layout shift)</em>
          </span>
          {SORTS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setPreference((prev) => ({ ...prev, sort: option.value }))}
              className={
                preference.sort === option.value
                  ? `${styles.densityButton} ${styles.densityButtonSelected}`
                  : styles.densityButton
              }
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <p className={styles.hint} data-quality={MODE_QUALITY[mode]}>
        {MODE_DESCRIPTIONS[mode]}
      </p>

      <Cards key={mode} mode={mode} preference={preference} onChangePreference={setPreference} />
    </div>
  );
}
