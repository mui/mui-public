import { experimental_streamedQuery as streamedQuery, useQuery } from '@tanstack/react-query';
import type { ChangedFile, DiffOptions, FileDiffResult } from './packageDiff';
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

export interface PackageDiffState {
  /** The changed files in display order, without those that turned out unchanged. */
  files: ChangedFile[];
  /** The diffs computed so far by path, `null` for files that turned out unchanged. */
  results: ReadonlyMap<string, FileDiffResult | null>;
  /** How many files are being diffed in total. */
  total: number;
}

type PackageDiffChunk = Extract<PackageDiffResponse, { type: 'files' | 'results' }>;

const INITIAL_STATE: PackageDiffState = { files: [], results: new Map(), total: 0 };

function reduceChunk(state: PackageDiffState, chunk: PackageDiffChunk): PackageDiffState {
  if (chunk.type === 'files') {
    return { files: chunk.files, results: new Map(), total: chunk.files.length };
  }
  const results = new Map([...state.results, ...chunk.results]);
  // Keep the same list unless files dropped out, so the file tree isn't rebuilt for nothing
  const files = chunk.results.some(([, result]) => result === null)
    ? state.files.filter((file) => results.get(file.path) !== null)
    : state.files;
  return { files, results, total: state.total };
}

let worker: Worker | null = null;
let nextRequestId = 0;
const listeners = new Map<number, (response: PackageDiffResponse) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./packageDiff.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (event: MessageEvent<PackageDiffResponse>) => {
      listeners.get(event.data.id)?.(event.data);
    });
    worker.addEventListener('error', (event) => {
      // The worker failed to load or threw outside a request, nothing in flight will answer
      const failure = { message: event.message || 'Package diff worker failed' };
      for (const [id, listener] of listeners) {
        listener({ id, type: 'failure', failure });
      }
      worker?.terminate();
      worker = null;
    });
  }
  return worker;
}

async function* streamPackageDiff(
  oldSpec: string,
  newSpec: string,
  options: DiffOptions,
  signal: AbortSignal,
): AsyncGenerator<PackageDiffChunk> {
  nextRequestId += 1;
  const id = nextRequestId;

  // Responses that arrived while nobody was waiting, or the one waiting for the next.
  // `null` means the request was aborted.
  const queue: (PackageDiffResponse | null)[] = [];
  let waiting: ((response: PackageDiffResponse | null) => void) | null = null;
  const push = (response: PackageDiffResponse | null) => {
    if (waiting) {
      waiting(response);
      waiting = null;
    } else {
      queue.push(response);
    }
  };
  const next = () =>
    queue.length > 0
      ? Promise.resolve(queue.shift()!)
      : new Promise<PackageDiffResponse | null>((resolve) => {
          waiting = resolve;
        });
  listeners.set(id, push);
  const onAbort = () => push(null);
  signal.addEventListener('abort', onAbort);

  const request: PackageDiffRequest = { type: 'diff', id, oldSpec, newSpec, options };
  getWorker().postMessage(request);
  try {
    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const response = await next();
      if (!response || response.type === 'done') {
        return;
      }
      if (response.type === 'failure') {
        throw new PackageDiffError(response.failure);
      }
      yield response;
    }
  } finally {
    listeners.delete(id);
    signal.removeEventListener('abort', onAbort);
    // Nothing happens when the worker is done with it already
    const cancel: PackageDiffRequest = { type: 'cancel', id };
    worker?.postMessage(cancel);
  }
}

export function usePackageDiff(
  oldSpec: string | null,
  newSpec: string | null,
  options: DiffOptions,
) {
  return useQuery<PackageDiffState, PackageDiffError>({
    queryKey: ['package-diff', oldSpec, newSpec, options],
    queryFn: streamedQuery({
      streamFn: ({ signal }) => streamPackageDiff(oldSpec!, newSpec!, options, signal),
      reducer: reduceChunk,
      initialValue: INITIAL_STATE,
    }),
    enabled: Boolean(oldSpec?.trim() && newSpec?.trim()),
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
    // Results are replaced chunk by chunk, there is nothing to share between them
    structuralSharing: false,
    // Keep showing the current diff while it's recomputed with other options for the same packages
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === oldSpec && previousQuery?.queryKey[2] === newSpec
        ? previousData
        : undefined,
  });
}
