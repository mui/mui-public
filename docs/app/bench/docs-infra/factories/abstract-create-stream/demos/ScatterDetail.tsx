'use client';

import * as React from 'react';
import { useCoordinatedContent } from '@mui/internal-docs-infra/CoordinatedLazy';
import { DETAIL_FILL, POINT_RADIUS, type Cluster, type DetailChunk } from './scatterConstants';
import { CoarseOverlay, ScatterFrame, StatusIndicator } from './scatterParts';

// One chunk's detailed dots in its own paint-contained <svg>. Memoized so growing
// the painted list never re-renders the chunks already mounted — and dropping the
// overlay to reveal them doesn't either.
const DetailChunkSvg = React.memo(function DetailChunkSvg({ chunk }: { chunk: DetailChunk }) {
  return (
    <svg
      width={chunk.rect.w}
      height={chunk.rect.h}
      viewBox={`${chunk.rect.x} ${chunk.rect.y} ${chunk.rect.w} ${chunk.rect.h}`}
      style={{ position: 'absolute', left: chunk.rect.x, top: chunk.rect.y, contain: 'strict' }}
    >
      {chunk.points.map((point, index) => (
        <circle key={index} cx={point.x} cy={point.y} r={POINT_RADIUS} fill={DETAIL_FILL} />
      ))}
    </svg>
  );
});

// The `CoordinatedLazy` content: the detailed `chunks` arrive as a prop, but the
// coarse `clusters` come only from the fallback's hoist (`useCoordinatedContent`).
// Paint one detail chunk per frame behind the opaque coarse overlay — rendered and
// painted, but never visible — then, once every chunk is painted, drop the overlay
// in a single commit to reveal the whole scatter at once (no re-render of the
// detail). The status pill switches to a checkmark + the render time.
export function ScatterDetail({ chunks }: { chunks: DetailChunk[] }) {
  // @focus-start @padding 1
  const hoisted = useCoordinatedContent();
  const clusters: Cluster[] = Array.isArray(hoisted.clusters) ? hoisted.clusters : [];
  const total = chunks.length;

  const [painted, setPainted] = React.useState(0);
  const [revealed, setRevealed] = React.useState(false);
  const [renderStart] = React.useState(() => performance.now());
  const [elapsed, setElapsed] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (revealed || total === 0) {
      return undefined;
    }
    if (painted >= total) {
      // Every chunk is painted behind the overlay. Wait one extra frame so the
      // last chunk has rasterized, then reveal everything at once and stamp the
      // elapsed render time.
      let second = 0;
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => {
          setElapsed((performance.now() - renderStart) / 1000);
          setRevealed(true);
        });
      });
      return () => {
        cancelAnimationFrame(first);
        cancelAnimationFrame(second);
      };
    }
    // Mount (and paint) the next chunk's detail, one at a time.
    const next = requestAnimationFrame(() => setPainted((value) => value + 1));
    return () => cancelAnimationFrame(next);
  }, [painted, total, revealed, renderStart]);

  return (
    <ScatterFrame>
      {chunks.slice(0, painted).map((chunk, index) => (
        <DetailChunkSvg key={index} chunk={chunk} />
      ))}
      {!revealed && <CoarseOverlay clusters={clusters} />}
      <StatusIndicator
        done={revealed}
        label={
          revealed
            ? `${(elapsed ?? 0).toFixed(1)}s`
            : `painting ${Math.min(painted, total)} / ${total}`
        }
      />
    </ScatterFrame>
  );
  // @focus-end
}
