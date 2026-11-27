// The CPU warm-up the harness runs before what it times; "Warming the CPU up" in the README says why,
// and what it doesn't cover. Only the harness calls it, right where its timing starts (before a
// case's `run`, and in `mainThreadTime()` after its wait for an idle thread), so that the spinning
// can never land inside a measurement.
import { benchmarkTrackDetail } from './trace';

/** How long a chunk of the fixed work takes on a warm CPU: long enough for the coarse page timer. */
const CHUNK_MS = 5;
/** How long the CPU spins before calibrating, so that it reaches full speed. */
const SPIN_UP_MS = 300;
/** Warm chunks timed to calibrate. */
const CALIBRATION_CHUNKS = 20;
/** How much slower than the fastest warm chunk a chunk may always be and still count as warm. */
const TOLERANCE = 0.02;
/** The page timer's resolution, which a chunk's duration can be off by. */
const TIMER_RESOLUTION_MS = 0.1;
/** The longest a warm-up spins before giving up on reaching warm speed. */
const CAP_MS = 300;
/** Untimed runs of the chunk on a fresh page, so that it is compiled before it is timed. */
const JIT_RUNS = 20;

const enabled = process.env.BENCHMARK_CPU_WARMUP === 'true';

// Kept in a module variable so the work has an effect the engine can't optimize away.
let sink = 0;

function runChunk(iterations: number): void {
  let value = sink;
  for (let i = 0; i < iterations; i += 1) {
    value = (value * 1103515245 + 12345) % 2147483647;
  }
  sink = value;
}

function timeChunk(iterations: number): number {
  const start = performance.now();
  runChunk(iterations);
  return performance.now() - start;
}

interface Calibration {
  /** The fixed work one chunk does. */
  iterations: number;
  /** The longest a chunk may take on a warm CPU. */
  threshold: number;
}

/** This page's calibration, kept until the page goes even when a warm-up gives up on it. */
let calibration: Calibration | null = null;

/**
 * Where a calibration outlives the page: the runner loads a file's pages in one tab, afresh every
 * round, so the session keeps it from one round to the next, and calibrating takes place once per
 * file rather than once per round. Every build runs on the same CPU, so they share it.
 */
const STORAGE_KEY = 'mui-benchmark:cpu-warmup';

function loadCalibration(): Calibration | null {
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null');
    return stored &&
      Number.isFinite(stored.iterations) &&
      stored.iterations > 0 &&
      stored.threshold > 0
      ? stored
      : null;
  } catch {
    // Storage unavailable or unreadable: calibrate anew.
    return null;
  }
}

// Storage unavailable: the next page calibrates anew, which costs time, not correctness.
function storeCalibration(value: Calibration): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // See above.
  }
}

function forgetCalibration(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // See above.
  }
}

/**
 * Sizes a chunk and finds how long it takes warm. Spins long enough for the CPU to reach full speed,
 * then times warm chunks: a chunk counts as warm when it is no slower than their median, and never
 * needs to beat the fastest of them by more than `TOLERANCE`. The ramp after idle goes in steps, so
 * only a known warm speed tells a warm CPU from one that has merely stopped speeding up; and the
 * median, rather than the fastest chunk, keeps a noisy machine from setting a speed it rarely
 * reaches again.
 */
function calibrate(): Calibration {
  let iterations = 1000;
  while (timeChunk(iterations) < CHUNK_MS) {
    iterations *= 2;
  }
  const start = performance.now();
  let fastest = Infinity;
  while (performance.now() - start < SPIN_UP_MS) {
    fastest = Math.min(fastest, timeChunk(iterations));
  }
  // The chunk was sized on a CPU that may have been slow, and in a slower tier of the engine:
  // resize it to take `CHUNK_MS` warm. The coarse timer can read a fast chunk as 0.
  iterations = Math.max(
    1,
    Math.round((iterations * CHUNK_MS) / Math.max(fastest, TIMER_RESOLUTION_MS)),
  );
  const chunks = Array.from({ length: CALIBRATION_CHUNKS }, () => timeChunk(iterations)).sort(
    (left, right) => left - right,
  );
  const median = chunks[Math.floor(chunks.length / 2)];
  const threshold = Math.max(median, chunks[0] * (1 + TOLERANCE)) + TIMER_RESOLUTION_MS;
  return { iterations, threshold };
}

/** The longest warm-up of the running sample, past calibrating. */
let longestWarmupMs = 0;

/**
 * Spins the CPU until a chunk of fixed work runs as fast as on a warm CPU, or for at most `CAP_MS`.
 * On a CPU that is already warm, that is a chunk or two. Does nothing unless the pages were built
 * with the warm-up on.
 */
export function warmUpCpu(): void {
  if (!enabled) {
    return;
  }
  if (!calibration) {
    // A fresh page runs the chunk in a slow tier of the engine until it is compiled, which would
    // look like a cold CPU.
    for (let i = 0; i < JIT_RUNS; i += 1) {
      runChunk(1000);
    }
    calibration = loadCalibration();
    if (!calibration) {
      calibration = calibrate();
      storeCalibration(calibration);
    }
  }
  const start = performance.now();
  while (timeChunk(calibration.iterations) > calibration.threshold) {
    if (performance.now() - start >= CAP_MS) {
      // Never warm enough: the CPU's warm speed has dropped, from heat or load. This page keeps its
      // calibration, so that later warm-ups here don't recalibrate inside a sample; the next page
      // calibrates anew.
      forgetCalibration();
      break;
    }
  }
  const end = performance.now();
  longestWarmupMs = Math.max(longestWarmupMs, end - start);
  performance.measure('warm-up', { start, end, detail: benchmarkTrackDetail('tertiary') });
}

/**
 * The longest warm-up since the last call, which starts the count again; `undefined` when the pages
 * don't warm up.
 */
export function takeLongestWarmupMs(): number | undefined {
  if (!enabled) {
    return undefined;
  }
  const taken = longestWarmupMs;
  longestWarmupMs = 0;
  return taken;
}
