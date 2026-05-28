'use client';
import * as React from 'react';
import { useCoordinated } from '@mui/internal-docs-infra/useCoordinated';
import { useScrollAnchor } from '@mui/internal-docs-infra/useScrollAnchor';
import styles from './AnchorCombo.module.css';

type Detail = 'summary' | 'expanded' | 'verbose';
type Mode = 'no-anchor' | 'with-anchor';

const DETAILS: Detail[] = ['summary', 'expanded', 'verbose'];

// The cards above the toggle button grow taller as detail level
// rises, so flipping detail pushes the button further down the
// page. The point of this demo: only the combination of
// useCoordinated (everyone flips at once → one anchor moment) and
// useScrollAnchor (pin the button across that moment) keeps the
// page calm for the user.
const PANELS = {
  Releases: {
    summary: ['v1.4.0 shipped'],
    expanded: [
      'v1.4.0 shipped',
      'v1.4.0 — adds caching for type lookups',
      'v1.3.2 — bug fix in MDX loader',
    ],
    verbose: [
      'v1.4.0 shipped',
      'v1.4.0 — adds caching for type lookups',
      'v1.3.2 — bug fix in MDX loader',
      'v1.3.1 — perf: skip re-parsing unchanged source',
      'v1.3.0 — new useCoordinated hook',
      'v1.2.6 — types: narrow OnSiblingAnnounce',
      'v1.2.5 — fix: race in barrier cancellation',
    ],
  },
  Issues: {
    summary: ['8 open'],
    expanded: [
      '8 open',
      '#411 — Type extraction times out on circular generics',
      '#408 — Loader misses .mdx in nested routes',
    ],
    verbose: [
      '8 open',
      '#411 — Type extraction times out on circular generics',
      '#408 — Loader misses .mdx in nested routes',
      '#405 — Code snippet copy-button steals focus',
      '#403 — Live editor flashes on first paint',
      '#401 — Demo iframe sandbox blocks fetch',
      '#398 — Sidebar collapses on hover',
      '#395 — Search results truncated on Safari',
    ],
  },
  Activity: {
    summary: ['12 commits today'],
    expanded: [
      '12 commits today',
      'Merged #410 — feat: precomputed types',
      'Opened #412 — investigate flaky test',
    ],
    verbose: [
      '12 commits today',
      'Merged #410 — feat: precomputed types',
      'Opened #412 — investigate flaky test',
      'Reviewed #407, #409, #410',
      'Deployed preview to render-pr-1371',
      'Updated 3 dependencies via renovate',
      'Triaged 5 incoming issues',
    ],
  },
} as const;

type PanelName = keyof typeof PANELS;
const PANEL_NAMES: PanelName[] = ['Releases', 'Issues', 'Activity'];

// Modest, varied latencies — just enough to make the coordinated
// commit feel batched.
const FETCH_DELAYS: Record<PanelName, number> = {
  Releases: 150,
  Issues: 350,
  Activity: 550,
};

function fetchLines(
  panel: PanelName,
  detail: Detail,
  signal: AbortSignal,
): Promise<readonly string[]> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => resolve(PANELS[panel][detail]), FETCH_DELAYS[panel]);
    signal.addEventListener('abort', () => {
      clearTimeout(id);
      reject(new Error('aborted'));
    });
  });
}

const MODE_QUALITY: Record<Mode, 'bad' | 'good'> = {
  'no-anchor': 'bad',
  'with-anchor': 'good',
};

const MODE_LABELS: Record<Mode, string> = {
  'no-anchor': 'Only useCoordinated',
  'with-anchor': 'useCoordinated + useScrollAnchor',
};

const MODE_BADGES: Record<Mode, string> = {
  'no-anchor': 'Problem',
  'with-anchor': 'Fix',
};

const MODE_DESCRIPTIONS: Record<Mode, string> = {
  'no-anchor':
    'The cards already flip together thanks to useCoordinated — but the button you clicked is below them, so the commit pushes it down off-screen in a single jump. Your cursor sits where the button used to be.',
  'with-anchor':
    'Same coordinated commit, but useScrollAnchor pins the button before the layout change. The cards still flip together; the page scrolls to keep the button under your cursor as content grows above it.',
};

function PanelCard({
  panel,
  detail,
  onChangeDetail,
}: {
  panel: PanelName;
  detail: Detail;
  onChangeDetail: (next: Detail) => void;
}) {
  const tuple = React.useMemo<[Detail, (next: Detail) => void]>(
    () => [detail, onChangeDetail],
    [detail, onChangeDetail],
  );
  const [lines, setLines] = React.useState<readonly string[]>(PANELS[panel][detail]);

  // @focus-start @padding 1
  const [visibleDetail, , extras] = useCoordinated<Detail, readonly string[]>(tuple, {
    channelKey: 'anchor-combo-demo',
    peerId: `coord-${panel}`,
    causesLayoutShift: () => true,
    preload: (target, signal) => fetchLines(panel, target, signal),
    // I/O-bound preload — show the card's loading badge while the
    // fetch is in flight rather than holding it until commit.
    animateDuringPreload: true,
    onCommit: (_target, preloaded) => {
      if (preloaded) {
        setLines(preloaded);
      }
    },
    ultimateTimeoutMs: 3000,
    gracePeriodMs: 500,
  });
  // @focus-end

  return (
    <div className={styles.card} data-loading={extras.isCoordinating || undefined}>
      <div className={styles.cardHeader}>
        <span className={styles.cardTitle}>{panel}</span>
        {extras.isCoordinating ? <span className={styles.cardBadge}>Loading…</span> : null}
      </div>
      <p className={styles.cardMeta}>
        Detail: <strong>{visibleDetail}</strong>
        {extras.pendingValue !== visibleDetail ? (
          <span className={styles.cardPending}>→ {extras.pendingValue}</span>
        ) : null}
      </p>
      <ul className={styles.cardLines}>
        {lines.map((line) => (
          <li key={`${panel}-${line}`}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

function Stage({ mode }: { mode: Mode }) {
  // Default to `summary`: going from a larger detail level toward
  // `summary` shrinks the cards above the button, which shifts the
  // page upward without pushing the button off-screen, so the
  // demo's initial state is the "calmest" baseline.
  const [detail, setDetail] = React.useState<Detail>('summary');
  // Anchor the page on the button itself: when the cards above grow
  // taller, the button stays at the same viewport offset under the
  // user's cursor instead of being pushed off-screen.
  const { containerRef, scrollContainerRef, anchorScroll } = useScrollAnchor<
    HTMLDivElement,
    HTMLDivElement
  >();
  const buttonRowRef = React.useRef<HTMLDivElement>(null);

  // Long enough to cover the slowest coordinated commit
  // (max(FETCH_DELAYS) ≈ 550 ms) plus a generous safety margin.
  const ANCHOR_DURATION_MS = 1200;

  const changeDetail = React.useCallback(
    (next: Detail) => {
      if (mode === 'with-anchor') {
        anchorScroll(buttonRowRef.current, ANCHOR_DURATION_MS);
      }
      setDetail(next);
    },
    [mode, anchorScroll],
  );

  return (
    <div className={styles.viewport} ref={scrollContainerRef}>
      <div className={styles.intro}>
        <span className={styles.scrollHint}>
          Scroll this panel so the “Change detail” buttons sit near the bottom edge, then click{' '}
          <code>verbose</code> or <code>summary</code>. The cards above will grow or shrink past the
          viewport — watch where the button row ends up.
        </span>
      </div>
      <div className={styles.cards} ref={containerRef}>
        {PANEL_NAMES.map((panel) => (
          <PanelCard key={panel} panel={panel} detail={detail} onChangeDetail={setDetail} />
        ))}
      </div>
      <div className={styles.buttonRow} ref={buttonRowRef}>
        <span className={styles.buttonRowLabel}>Change detail:</span>
        {DETAILS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => changeDetail(option)}
            className={
              detail === option
                ? `${styles.detailButton} ${styles.detailButtonSelected}`
                : styles.detailButton
            }
          >
            {option}
          </button>
        ))}
      </div>
      <div className={styles.outro}>
        <p>
          The button row above stays{' '}
          {mode === 'with-anchor'
            ? 'pinned at the same viewport offset — the panel scrolls under it to absorb the layout change.'
            : 'where the document flow puts it — if the cards above grow, it slides out of view below.'}
        </p>
      </div>
    </div>
  );
}

export function AnchorCombo() {
  const [mode, setMode] = React.useState<Mode>('no-anchor');

  return (
    <div className={styles.root} data-mode={mode}>
      <div className={styles.controls}>
        <fieldset className={styles.modePicker}>
          <legend className={styles.modeLegend}>Anchoring strategy</legend>
          {(Object.keys(MODE_LABELS) as Mode[]).map((value) => (
            <label
              key={value}
              className={styles.modeOption}
              data-active={value === mode}
              data-quality={MODE_QUALITY[value]}
            >
              <input
                type="radio"
                name="anchor-combo-mode"
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

      <p className={styles.hint} data-quality={MODE_QUALITY[mode]}>
        {MODE_DESCRIPTIONS[mode]}
      </p>

      <Stage key={mode} mode={mode} />
    </div>
  );
}
