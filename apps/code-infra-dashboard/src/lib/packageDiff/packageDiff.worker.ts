// Downloads, extracts, formats and diffs packages off the main thread. Only the diff
// blocks that get rendered are posted back.
import { downloadAndExtractPackage } from '../packageDownload';
import type { PackageContents } from '../packageDownload';
import { computePackageDiff } from './computePackageDiff';
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

async function handleRequest({ oldSpec, newSpec, options }: PackageDiffRequest) {
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
    return failure;
  }
  return computePackageDiff(oldResult.value, newResult.value, options);
}

globalThis.addEventListener('message', async (event: MessageEvent<PackageDiffRequest>) => {
  const { id } = event.data;
  let response: PackageDiffResponse;
  try {
    const result = await handleRequest(event.data);
    response = Array.isArray(result) ? { id, files: result } : { id, failure: result };
  } catch (error) {
    response = { id, failure: { message: getErrorMessage(error) } };
  }
  globalThis.postMessage(response);
});
