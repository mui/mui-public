import { experimental_streamedQuery as streamedQuery, useQuery } from '@tanstack/react-query';
import type { ChangedFile, DiffOptions, FileDiffResult } from './packageDiff';
import type {
  PackageDiffChunk,
  PackageDiffFailure,
  PackageDiffRequest,
  PackageDiffResponse,
} from './protocol';

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
  /** The changed files, in display order. */
  files: ChangedFile[];
  /** The diffs computed so far, by path. */
  results: ReadonlyMap<string, FileDiffResult>;
  /** Files that turned out unchanged once formatted. */
  unchanged: ReadonlySet<string>;
}

const INITIAL_STATE: PackageDiffState = { files: [], results: new Map(), unchanged: new Set() };

function reduceChunk(state: PackageDiffState, chunk: PackageDiffChunk): PackageDiffState {
  if (chunk.type === 'files') {
    return { ...state, files: chunk.files };
  }
  return {
    files: state.files,
    results: new Map([
      ...state.results,
      ...chunk.results.map((result) => [result.path, result] as const),
    ]),
    unchanged: new Set([...state.unchanged, ...chunk.unchanged]),
  };
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
  // Responses that arrived while nobody was waiting, and the waiter otherwise
  const queue: PackageDiffResponse[] = [];
  let waiting: ((response: PackageDiffResponse | null) => void) | null = null;
  listeners.set(id, (response) => {
    if (waiting) {
      waiting(response);
      waiting = null;
    } else {
      queue.push(response);
    }
  });
  const onAbort = () => {
    waiting?.(null);
    waiting = null;
  };
  signal.addEventListener('abort', onAbort);
  const next = () =>
    queue.length > 0
      ? Promise.resolve(queue.shift()!)
      : new Promise<PackageDiffResponse | null>((resolve) => {
          waiting = resolve;
        });

  const request: PackageDiffRequest = { type: 'diff', id, oldSpec, newSpec, options };
  getWorker().postMessage(request);

  let finished = false;
  try {
    while (!signal.aborted) {
      // eslint-disable-next-line no-await-in-loop
      const response = await next();
      if (!response) {
        return;
      }
      if (response.type === 'chunk') {
        yield response.chunk;
      } else if (response.type === 'done') {
        finished = true;
        return;
      } else {
        finished = true;
        throw new PackageDiffError(response.failure);
      }
    }
  } finally {
    listeners.delete(id);
    signal.removeEventListener('abort', onAbort);
    if (!finished) {
      const cancel: PackageDiffRequest = { type: 'cancel', id };
      worker?.postMessage(cancel);
    }
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
