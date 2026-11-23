// Downloads, extracts, formats and diffs packages off the main thread. Only the diff
// blocks that get rendered are posted back.
import { downloadAndExtractPackage } from '../packageDownload';
import type { PackageContents } from '../packageDownload';
import { computePackageDiff } from './computePackageDiff';
import type {
  PackageDiffRequest,
  PackageDiffResponse,
  PackageDiffResult,
  PackageOutcome,
} from './protocol';

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

function toOutcome(result: PromiseSettledResult<PackageContents>): PackageOutcome {
  if (result.status === 'rejected') {
    return {
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
  }
  return { name: result.value.name, version: result.value.version };
}

async function handleRequest({
  oldSpec,
  newSpec,
  options,
}: PackageDiffRequest): Promise<PackageDiffResult> {
  const [oldResult, newResult] = await Promise.allSettled([
    getPackage(oldSpec),
    getPackage(newSpec),
  ]);
  const files =
    oldResult.status === 'fulfilled' && newResult.status === 'fulfilled'
      ? await computePackageDiff(oldResult.value, newResult.value, options)
      : null;
  return { oldPackage: toOutcome(oldResult), newPackage: toOutcome(newResult), files };
}

globalThis.addEventListener('message', async (event: MessageEvent<PackageDiffRequest>) => {
  let response: PackageDiffResponse;
  try {
    response = { id: event.data.id, result: await handleRequest(event.data) };
  } catch (error) {
    response = { id: event.data.id, error: error instanceof Error ? error.message : String(error) };
  }
  globalThis.postMessage(response);
});
