// Downloads, extracts, formats and diffs packages off the main thread. Only the diff
// blocks that get rendered are posted back, file by file as they finish.
import { downloadAndExtractPackage } from '../packageDownload';
import type { PackageContents } from '../packageDownload';
import { createPackageDiff, getErrorMessage } from './packageDiff';
import type { FileDiffResult } from './packageDiff';
import type { PackageDiffFailure, PackageDiffRequest, PackageDiffResponse } from './protocol';

// Holds the packages of the latest request only, so toggling diff options reuses the
// download and formatted files. Earlier diffs are cached as results on the main thread.
const packages = new Map<string, Promise<PackageContents>>();

function getPackage(spec: string): Promise<PackageContents> {
  let pkg = packages.get(spec);
  if (!pkg) {
    pkg = downloadAndExtractPackage(spec);
    // Don't cache failures, a retry may succeed
    pkg.catch(() => packages.delete(spec));
    packages.set(spec, pkg);
  }
  return pkg;
}

// How often to post finished files, so the page isn't re-rendered for every small file
const FLUSH_INTERVAL_MS = 50;

// Only the latest request is worked on, a newer one or a cancel stops it
let currentRequestId = 0;

function post(response: PackageDiffResponse) {
  globalThis.postMessage(response);
}

// Formatting is async but never yields to the event loop on its own, a macrotask lets
// incoming requests through. A message channel, because nested timeouts get clamped to 4ms.
const yieldChannel = new MessageChannel();
// A superseded request can still be waiting while the next one yields
const yieldWaiters: (() => void)[] = [];
yieldChannel.port1.onmessage = () => yieldWaiters.shift()?.();
function yieldToEventLoop() {
  return new Promise<void>((resolve) => {
    yieldWaiters.push(resolve);
    yieldChannel.port2.postMessage(null);
  });
}

async function streamDiff({
  id,
  oldSpec,
  newSpec,
  options,
}: Extract<PackageDiffRequest, { type: 'diff' }>) {
  for (const spec of packages.keys()) {
    if (spec !== oldSpec && spec !== newSpec) {
      packages.delete(spec);
    }
  }

  const [oldResult, newResult] = await Promise.allSettled([
    getPackage(oldSpec),
    getPackage(newSpec),
  ]);
  if (oldResult.status === 'rejected' || newResult.status === 'rejected') {
    const failure: PackageDiffFailure = { message: 'Failed to download the packages' };
    if (oldResult.status === 'rejected') {
      failure.oldError = getErrorMessage(oldResult.reason);
    }
    if (newResult.status === 'rejected') {
      failure.newError = getErrorMessage(newResult.reason);
    }
    post({ id, type: 'failure', failure });
    return;
  }

  const diff = createPackageDiff(oldResult.value, newResult.value);
  post({ id, type: 'files', files: diff.files });

  let results: [string, FileDiffResult | null][] = [];
  // Post the first file right away, it's the one in view
  let lastFlush = -Infinity;
  for (const file of diff.files) {
    // eslint-disable-next-line no-await-in-loop
    await yieldToEventLoop();
    if (currentRequestId !== id) {
      return;
    }
    // eslint-disable-next-line no-await-in-loop -- one file at a time, in display order
    results.push([file.path, await diff.diffFile(file, options)]);
    if (performance.now() - lastFlush >= FLUSH_INTERVAL_MS) {
      post({ id, type: 'results', results });
      results = [];
      lastFlush = performance.now();
    }
  }
  if (results.length > 0) {
    post({ id, type: 'results', results });
  }
  post({ id, type: 'done' });
}

globalThis.addEventListener('message', async (event: MessageEvent<PackageDiffRequest>) => {
  const request = event.data;
  if (request.type === 'cancel') {
    if (currentRequestId === request.id) {
      currentRequestId = 0;
    }
    return;
  }
  currentRequestId = request.id;
  try {
    await streamDiff(request);
  } catch (error) {
    post({ id: request.id, type: 'failure', failure: { message: getErrorMessage(error) } });
  }
});
