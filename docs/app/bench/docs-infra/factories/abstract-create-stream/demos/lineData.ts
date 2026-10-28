// Server-side line dataset. Imported only by the server components below (the
// chunk `Loader` / `ChunkLoading`), so the 100k-point projection runs in RSC,
// never on the client.
export const TOTAL = 100_000;
export const CHUNK_SIZE = 1000;
export const CHUNK_COUNT = TOTAL / CHUNK_SIZE; // 100
export const SIMPLE_PER_CHUNK = 10;
export const WIDTH = 900;
export const HEIGHT = 220;

// A flowing multi-harmonic signal: a couple of low harmonics for the overall
// shape, plus finer detail whose amplitude swells and fades across the chart (the
// envelope) — so the coarse 10-point sampling captures the shape but misses the
// texture, and the full line reads as a lively trace rather than a fuzzy band.
const TAU = Math.PI * 2;
const curve = (t: number) => {
  const envelope = 0.4 + 0.6 * Math.abs(Math.sin(t * TAU * 1.3));
  const base = 0.6 * Math.sin(t * TAU * 2.4) + 0.26 * Math.sin(t * TAU * 5.7 + 0.8);
  const detail = envelope * (0.2 * Math.sin(t * TAU * 23) + 0.09 * Math.sin(t * TAU * 411));
  return HEIGHT / 2 - ((HEIGHT / 2 - 16) / 1.2) * (base + detail);
};

const project = (globalIndex: number) =>
  `${(globalIndex / TOTAL) * WIDTH},${curve(globalIndex / TOTAL)}`;

export interface LineData {
  fullPaths: string[];
  simplePaths: string[];
}

// Build every chunk's full (1000-point) and simplified (10-point) polyline string.
function computeLineData(): LineData {
  const fullPaths: string[] = [];
  const simplePaths: string[] = [];
  for (let chunk = 0; chunk < CHUNK_COUNT; chunk += 1) {
    const start = chunk * CHUNK_SIZE;
    const full: string[] = [];
    for (let offset = 0; offset <= CHUNK_SIZE; offset += 1) {
      full.push(project(start + offset));
    }
    fullPaths.push(full.join(' '));

    const simple: string[] = [];
    for (let step = 0; step < SIMPLE_PER_CHUNK; step += 1) {
      simple.push(project(start + Math.round((step / (SIMPLE_PER_CHUNK - 1)) * CHUNK_SIZE)));
    }
    simplePaths.push(simple.join(' '));
  }
  return { fullPaths, simplePaths };
}

// Computed once at module load — on the server, since only server components import this.
export const LINE = computeLineData();
