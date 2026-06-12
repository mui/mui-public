import * as React from 'react';
import { COARSE_FILL, FRAME_BG, HEIGHT, WIDTH, type Cluster } from './scatterConstants';

// The chart box: a contained grid the detail <svg>s and the overlay sit in.
export function ScatterFrame({ children }: { children?: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'relative',
        width: WIDTH,
        height: HEIGHT,
        overflow: 'hidden',
        contain: 'layout paint',
        border: '1px solid #d0cdd7',
        borderRadius: 8,
        background: FRAME_BG,
      }}
    >
      {children}
    </div>
  );
}

// The coarse scatter as an opaque overlay: an opaque layer (so the detailed dots
// painting behind it stay hidden) carrying the clusters in one svg. Memoized so
// it never re-renders while the detail paints, and removed in a single commit to
// reveal the detail. Both the fallback and the content render it from the same
// (hoisted) clusters, so the swap is seamless.
export const CoarseOverlay = React.memo(function CoarseOverlay({
  clusters,
}: {
  clusters: Cluster[];
}) {
  return (
    <div style={{ position: 'absolute', inset: 0, background: FRAME_BG, zIndex: 1 }}>
      <svg width={WIDTH} height={HEIGHT} style={{ position: 'absolute', inset: 0 }}>
        {clusters.map((cluster, index) => (
          <circle key={index} cx={cluster.x} cy={cluster.y} r={cluster.r} fill={COARSE_FILL} />
        ))}
      </svg>
    </div>
  );
});

// Bottom-right status pill: a spinner while work is in flight, a checkmark + the
// elapsed time once done. Presentational (no hooks), so it renders on the server
// too.
export function StatusIndicator({ done, label }: { done: boolean; label: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        right: 10,
        bottom: 10,
        zIndex: 2,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 10px',
        borderRadius: 999,
        background: 'rgba(255, 255, 255, 0.9)',
        boxShadow: '0 1px 4px rgba(0, 0, 0, 0.15)',
        fontSize: 12,
        color: '#5b5670',
      }}
    >
      {done ? (
        <span style={{ color: '#16a34a', fontWeight: 700, lineHeight: 1 }}>✓</span>
      ) : (
        <span
          style={{
            width: 12,
            height: 12,
            border: '2px solid #cdbef0',
            borderTopColor: '#7c3aed',
            borderRadius: '50%',
            display: 'inline-block',
            animation: 'scatter-spin 0.7s linear infinite',
          }}
        />
      )}
      {label}
      <style>{'@keyframes scatter-spin { to { transform: rotate(360deg); } }'}</style>
    </div>
  );
}

// The factory's `ChunkLoading`: shown only while the `Loader` import resolves
// (before any data). The real coarse comes from `ScatterChart`'s `CoordinatedLazy`
// fallback once it renders.
export function ScatterChartLoading() {
  return (
    <ScatterFrame>
      <StatusIndicator done={false} label="loading…" />
    </ScatterFrame>
  );
}
