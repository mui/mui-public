import * as React from 'react';

export interface Point {
  x: number;
  y: number;
}

export const WIDTH = 260;
export const HEIGHT = 100;

// The same underlying curve, sampled coarsely for the baseline and finely for the
// detailed line — so the swap reads as "coarse → refined", not two shapes.
const curve = (t: number) =>
  50 + 26 * Math.sin(t * Math.PI * 2.4) + 9 * Math.sin(t * Math.PI * 7.5);

const sample = (count: number): Point[] =>
  Array.from({ length: count }, (_unused, index) => {
    const t = index / (count - 1);
    return { x: t * WIDTH, y: curve(t) };
  });

// Low-resolution baseline — a coarse approximation. Detailed line — many points.
export const LOW_RES: Point[] = sample(9);
export const DETAILED: Point[] = sample(72);

export function Line({ points, detailed }: { points?: Point[]; detailed?: boolean }) {
  // @focus-start @padding 1
  const path = (points ?? []).map((point) => `${point.x},${HEIGHT - point.y}`).join(' ');
  return (
    <svg
      width={WIDTH}
      height={HEIGHT}
      style={{ border: '1px solid #d0cdd7', borderRadius: 8, background: '#faf9fc' }}
    >
      <polyline
        points={path}
        fill="none"
        stroke={detailed ? '#7c3aed' : '#b9aee0'}
        strokeWidth={detailed ? 2 : 1.5}
        strokeDasharray={detailed ? undefined : '4 3'}
      />
    </svg>
  );
  // @focus-end
}
