import { useQuery } from '@tanstack/react-query';
import type { DiffOptions } from './computePackageDiff';
import type { PackageDiffRequest, PackageDiffResponse, PackageDiffResult } from './protocol';

let worker: Worker | null = null;
let nextRequestId = 0;
const pendingRequests = new Map<
  number,
  { resolve: (result: PackageDiffResult) => void; reject: (error: Error) => void }
>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./packageDiff.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<PackageDiffResponse>) => {
      const pending = pendingRequests.get(event.data.id);
      pendingRequests.delete(event.data.id);
      if (!pending) {
        return;
      }
      if ('error' in event.data) {
        pending.reject(new Error(event.data.error));
      } else {
        pending.resolve(event.data.result);
      }
    });
    worker.addEventListener('error', (event) => {
      // The worker failed to load or threw outside a request, nothing in flight will answer
      for (const pending of pendingRequests.values()) {
        pending.reject(new Error(event.message || 'Package diff worker failed'));
      }
      pendingRequests.clear();
      worker?.terminate();
      worker = null;
    });
  }
  return worker;
}

function requestPackageDiff(
  oldSpec: string,
  newSpec: string,
  options: DiffOptions,
): Promise<PackageDiffResult> {
  return new Promise((resolve, reject) => {
    nextRequestId += 1;
    const request: PackageDiffRequest = { id: nextRequestId, oldSpec, newSpec, options };
    pendingRequests.set(request.id, { resolve, reject });
    getWorker().postMessage(request);
  });
}

export function usePackageDiff(
  oldSpec: string | null,
  newSpec: string | null,
  options: DiffOptions,
) {
  return useQuery({
    queryKey: ['package-diff', oldSpec, newSpec, options.ignoreWhitespace, options.format],
    queryFn: () => requestPackageDiff(oldSpec!, newSpec!, options),
    enabled: Boolean(oldSpec?.trim() && newSpec?.trim()),
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
    // Keep showing the current diff while it's recomputed with other options for the same packages
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === oldSpec && previousQuery?.queryKey[2] === newSpec
        ? previousData
        : undefined,
  });
}
