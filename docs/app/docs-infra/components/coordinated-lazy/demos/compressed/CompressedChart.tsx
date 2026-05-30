'use client';
import * as React from 'react';
import {
  CoordinatedLazy,
  useCoordinatedFallback,
  useCoordinatedContent,
} from '@mui/internal-docs-infra/CoordinatedLazy';
import { compressString, decompressString } from '@mui/internal-docs-infra/pipeline/hastUtils';

interface Point {
  x: number;
  y: number;
}

const WIDTH = 260;
const HEIGHT = 100;

// The same underlying curve, sampled coarsely for the baseline and finely for
// the detailed line.
const curve = (t: number) =>
  50 + 26 * Math.sin(t * Math.PI * 2.4) + 9 * Math.sin(t * Math.PI * 7.5);
const sample = (count: number): Point[] =>
  Array.from({ length: count }, (_unused, index) => {
    const t = index / (count - 1);
    return { x: t * WIDTH, y: curve(t) };
  });

const LOW_RES: Point[] = sample(9);
const DETAILED: Point[] = sample(72);

// The low-res baseline doubles as the DEFLATE dictionary. The detailed payload
// is pre-compressed against it, so only the compressed delta crosses to the
// full content — which decodes it using the baseline the fallback hoisted.
const BASELINE = JSON.stringify(LOW_RES);
const COMPRESSED = compressString(JSON.stringify(DETAILED), BASELINE);

function Line({
  points,
  detailed,
  caption,
}: {
  points: Point[];
  detailed?: boolean;
  caption: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <svg
        width={WIDTH}
        height={HEIGHT}
        style={{ border: '1px solid #d0cdd7', borderRadius: 8, background: '#faf9fc' }}
      >
        <polyline
          points={points.map((point) => `${point.x},${HEIGHT - point.y}`).join(' ')}
          fill="none"
          stroke={detailed ? '#7c3aed' : '#b9aee0'}
          strokeWidth={detailed ? 2 : 1.5}
          strokeDasharray={detailed ? undefined : '4 3'}
        />
      </svg>
      <div style={{ font: '13px monospace', color: detailed ? '#3f8f3f' : '#7c3aed' }}>
        {caption}
      </div>
    </div>
  );
}

function Loading() {
  // Paint the low-res line and hoist the baseline as the decompression dictionary.
  useCoordinatedFallback(React.useMemo(() => ({ baseline: BASELINE }), []));
  return (
    <Line
      points={LOW_RES}
      caption={`low-res + dictionary (${COMPRESSED.length}b compressed delta)`}
    />
  );
}

function Content() {
  const hoisted = useCoordinatedContent();
  const detailed = React.useMemo<Point[]>(
    () => JSON.parse(decompressString(COMPRESSED, hoisted.baseline as string)),
    [hoisted.baseline],
  );
  return (
    <Line points={detailed} detailed caption="detailed — decoded against the hoisted baseline" />
  );
}

export function CompressedChart() {
  // @focus-start @padding 1
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    const id = setTimeout(() => setReady(true), 1400);
    return () => clearTimeout(id);
  }, []);

  // `requireHoist` holds the swap until the fallback has hoisted the baseline,
  // so the content always has the dictionary it needs to decode.
  return (
    <CoordinatedLazy ready={ready} requireHoist fallback={<Loading />} content={<Content />} />
  );
  // @focus-end
}
