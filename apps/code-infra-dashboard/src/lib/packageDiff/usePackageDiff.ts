import { useQuery } from '@tanstack/react-query';
import type { DiffOptions, FileDiffResult } from './computePackageDiff';
import type { PackageDiffFailure, PackageDiffRequest, PackageDiffResponse } from './protocol';

export class PackageDiffError extends Error {
  declare oldError?: string;

  declare newError?: string;

  constructor({ message, oldError, newError }: PackageDiffFailure) {
    super(message);
    this.oldError = oldError;
    this.newError = newError;
  }
}

let worker: Worker | null = null;
let nextRequestId = 0;
const pendingRequests = new Map<
  number,
  { resolve: (files: FileDiffResult[]) => void; reject: (error: PackageDiffError) => void }
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
      if ('failure' in event.data) {
        pending.reject(new PackageDiffError(event.data.failure));
      } else {
        pending.resolve(event.data.files);
      }
    });
    worker.addEventListener('error', (event) => {
      // The worker failed to load or threw outside a request, nothing in flight will answer
      for (const pending of pendingRequests.values()) {
        pending.reject(
          new PackageDiffError({ message: event.message || 'Package diff worker failed' }),
        );
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
): Promise<FileDiffResult[]> {
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
  return useQuery<FileDiffResult[], PackageDiffError>({
    queryKey: ['package-diff', oldSpec, newSpec, options],
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
