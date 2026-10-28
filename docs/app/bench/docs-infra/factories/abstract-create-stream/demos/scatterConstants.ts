// Light constants + types shared by the source loaders, the fallback, and the
// content. Free of the compute so any of them can import it cheaply.
export const WIDTH = 900;
export const HEIGHT = 400;
export const POINT_RADIUS = 0.8; // detailed dot radius (and boundary spill distance)

export const FRAME_BG = '#faf9fc';
export const COARSE_FILL = '#cdbef0';
export const DETAIL_FILL = '#7c3aed';

export interface Point {
  x: number;
  y: number;
}
export interface Cluster {
  x: number;
  y: number;
  r: number;
}
export interface DetailChunk {
  rect: { x: number; y: number; w: number; h: number };
  points: Point[];
}
