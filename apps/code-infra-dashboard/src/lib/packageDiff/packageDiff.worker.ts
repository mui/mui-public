// Downloads, extracts, formats and diffs packages off the main thread. Only the diff
// blocks that get rendered are posted back, file by file as they finish.
import { downloadAndExtractPackage } from '../packageDownload';
import type { PackageContents } from '../packageDownload';
import { createPackageDiff } from './packageDiff';
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// How often to post finished files, so the page isn't re-rendered for every small file
const FLUSH_INTERVAL_MS = 50;

const activeRequests = new Set<number>();

function post(response: PackageDiffResponse) {
  globalThis.postMessage(response);
}

// Formatting is async but never yields to the event loop on its own, a macrotask lets
// incoming `cancel` messages through.
function yieldToEventLoop() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
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
  post({ id, type: 'chunk', chunk: { type: 'files', files: diff.files } });

  let results: FileDiffResult[] = [];
  let unchanged: string[] = [];
  // Post the first file right away, it's the one in view
  let lastFlush = -Infinity;
  const flush = () => {
    post({ id, type: 'chunk', chunk: { type: 'results', results, unchanged } });
    results = [];
    unchanged = [];
    lastFlush = performance.now();
  };

  for (const file of diff.files) {
    if (!activeRequests.has(id)) {
      return;
    }
    // eslint-disable-next-line no-await-in-loop -- one file at a time, in display order
    const result = await diff.diffFile(file, options);
    if (result) {
      results.push(result);
    } else {
      unchanged.push(file.path);
    }
    if (performance.now() - lastFlush >= FLUSH_INTERVAL_MS) {
      flush();
      // eslint-disable-next-line no-await-in-loop
      await yieldToEventLoop();
    }
  }
  if (results.length > 0 || unchanged.length > 0) {
    flush();
  }
  post({ id, type: 'done' });
}

globalThis.addEventListener('message', async (event: MessageEvent<PackageDiffRequest>) => {
  const request = event.data;
  if (request.type === 'cancel') {
    activeRequests.delete(request.id);
    return;
  }
  activeRequests.add(request.id);
  try {
    await streamDiff(request);
  } catch (error) {
    post({ id: request.id, type: 'failure', failure: { message: getErrorMessage(error) } });
  } finally {
    activeRequests.delete(request.id);
  }
});
