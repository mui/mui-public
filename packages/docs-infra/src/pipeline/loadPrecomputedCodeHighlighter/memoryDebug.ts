// Lightweight memory instrumentation for the precomputed code highlighter
// loader. Enabled by setting `DEBUG_DOCS_INFRA_MEMORY=1` in the environment.
//
// Logs to stderr after every loader call (no throttling) so we can pinpoint
// exactly which call(s) cause memory cliffs during a Next.js production build.
//
// Each line shows BOTH the absolute snapshot AND the delta since the previous
// call. Lines whose delta exceeds `SPIKE_BYTES` on any axis are tagged
// `SPIKE` so they are easy to grep in long traces.
//
// `gap=Xms` is wall time since the previous loader call. Large gaps with no
// per-call attribution suggest the memory growth happened in webpack-internal
// work between our calls (e.g. cache serialization).
//
// Optional heap snapshots: set `DEBUG_DOCS_INFRA_HEAPSNAPSHOT=1` to write a
// `.heapsnapshot` file when RSS first crosses each successive 1 GB boundary
// past `DEBUG_DOCS_INFRA_HEAPSNAPSHOT_THRESHOLD_MB` (default 4096). Open the
// resulting file in Chrome DevTools → Memory tab to inspect retainers. Capped
// at `DEBUG_DOCS_INFRA_HEAPSNAPSHOT_MAX` snapshots (default 3) so the build
// doesn't fill the disk.

import * as v8 from 'node:v8';

const ENABLED = typeof process !== 'undefined' && process.env?.DEBUG_DOCS_INFRA_MEMORY === '1';

// Any single-call delta >= this threshold (on rss, heapUsed, external, or
// arrayBuffers) is flagged as a spike. 50 MB is small enough to surface real
// jumps but big enough to ignore routine GC noise.
const SPIKE_BYTES = 50 * 1024 * 1024;

const SNAPSHOTS_ENABLED =
  typeof process !== 'undefined' && process.env?.DEBUG_DOCS_INFRA_HEAPSNAPSHOT === '1';
const SNAPSHOT_FIRST_THRESHOLD_BYTES =
  Number(process.env?.DEBUG_DOCS_INFRA_HEAPSNAPSHOT_THRESHOLD_MB ?? 4096) * 1024 * 1024;
const SNAPSHOT_STEP_BYTES = 1024 * 1024 * 1024; // capture again every +1 GB
const SNAPSHOT_MAX = Number(process.env?.DEBUG_DOCS_INFRA_HEAPSNAPSHOT_MAX ?? 3);

let callCount = 0;
let cumulativeInputBytes = 0;
let cumulativeOutputBytes = 0;
let cumulativeDepCount = 0;
let peakRssBytes = 0;
let peakHeapBytes = 0;
let lastMem: NodeJS.MemoryUsage | null = null;
let lastCallAt = 0;
let firstCallAt = 0;
let snapshotsTaken = 0;
let nextSnapshotRssBytes = SNAPSHOT_FIRST_THRESHOLD_BYTES;

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function formatDeltaMb(bytes: number): string {
  const sign = bytes >= 0 ? '+' : '';
  return `${sign}${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function maybeWriteHeapSnapshot(rssBytes: number): void {
  if (!SNAPSHOTS_ENABLED) {
    return;
  }
  if (snapshotsTaken >= SNAPSHOT_MAX) {
    return;
  }
  if (rssBytes < nextSnapshotRssBytes) {
    return;
  }
  // Bump the next trigger immediately so a single huge call doesn't fire
  // multiple snapshots.
  nextSnapshotRssBytes = rssBytes + SNAPSHOT_STEP_BYTES;
  snapshotsTaken += 1;
  const label = `${formatMb(rssBytes).replace('.', '_')}_call${callCount}`;
  console.error(
    `[docs-infra:mem] writing heap snapshot #${snapshotsTaken} at rss=${formatMb(rssBytes)} ` +
      `(this will pause the process for several seconds)...`,
  );
  try {
    const filename = v8.writeHeapSnapshot(`./docs-infra-${label}.heapsnapshot`);
    console.error(`[docs-infra:mem] heap snapshot written: ${filename}`);
  } catch (error) {
    console.error(`[docs-infra:mem] heap snapshot failed: ${(error as Error).message}`);
  }
}

export function isMemoryDebugEnabled(): boolean {
  return ENABLED;
}

export function logLoaderCallMemory(params: {
  relativePath: string;
  inputBytes: number;
  outputBytes: number;
  variantCount: number;
  depCount: number;
}): void {
  if (!ENABLED) {
    return;
  }

  callCount += 1;
  cumulativeInputBytes += params.inputBytes;
  cumulativeOutputBytes += params.outputBytes;
  cumulativeDepCount += params.depCount;

  const mem = process.memoryUsage();
  if (mem.rss > peakRssBytes) {
    peakRssBytes = mem.rss;
  }
  if (mem.heapUsed > peakHeapBytes) {
    peakHeapBytes = mem.heapUsed;
  }

  const now = Date.now();
  if (firstCallAt === 0) {
    firstCallAt = now;
  }
  const sinceLastMs = lastCallAt === 0 ? 0 : now - lastCallAt;
  const sinceStartS = ((now - firstCallAt) / 1000).toFixed(1);
  lastCallAt = now;

  const dRss = lastMem ? mem.rss - lastMem.rss : 0;
  const dHeap = lastMem ? mem.heapUsed - lastMem.heapUsed : 0;
  const dExternal = lastMem ? mem.external - lastMem.external : 0;
  const dArrayBuffers = lastMem ? mem.arrayBuffers - lastMem.arrayBuffers : 0;
  lastMem = mem;

  const isSpike =
    Math.abs(dRss) >= SPIKE_BYTES ||
    Math.abs(dHeap) >= SPIKE_BYTES ||
    Math.abs(dExternal) >= SPIKE_BYTES ||
    Math.abs(dArrayBuffers) >= SPIKE_BYTES;

  const tag = isSpike ? '[docs-infra:mem SPIKE]' : '[docs-infra:mem]';

  console.error(
    `${tag} call#${callCount} t=${sinceStartS}s gap=${sinceLastMs}ms ` +
      `rss=${formatMb(mem.rss)}(${formatDeltaMb(dRss)}) ` +
      `heap=${formatMb(mem.heapUsed)}/${formatMb(mem.heapTotal)}(${formatDeltaMb(dHeap)}) ` +
      `external=${formatMb(mem.external)}(${formatDeltaMb(dExternal)}) ` +
      `arrayBuffers=${formatMb(mem.arrayBuffers)}(${formatDeltaMb(dArrayBuffers)}) ` +
      `peakRss=${formatMb(peakRssBytes)} peakHeap=${formatMb(peakHeapBytes)} ` +
      `in=${formatMb(params.inputBytes)} out=${formatMb(params.outputBytes)} ` +
      `cumIn=${formatMb(cumulativeInputBytes)} cumOut=${formatMb(cumulativeOutputBytes)} ` +
      `variants=${params.variantCount} ` +
      `deps=${params.depCount} (cum ${cumulativeDepCount}) ` +
      `path=${params.relativePath}`,
  );

  maybeWriteHeapSnapshot(mem.rss);
}
