import type { ChangedFile, DiffOptions, FileDiffResult } from './packageDiff';

export type PackageDiffRequest =
  | { type: 'diff'; id: number; oldSpec: string; newSpec: string; options: DiffOptions }
  /** Stop working on a request, nobody is waiting for it anymore. */
  | { type: 'cancel'; id: number };

export interface PackageDiffFailure {
  message: string;
  /** Why the old package couldn't be downloaded, if it couldn't. */
  oldError?: string;
  /** Why the new package couldn't be downloaded, if it couldn't. */
  newError?: string;
}

/** A diff streams in as one `files` chunk followed by `results` chunks in the same order. */
export type PackageDiffChunk =
  | { type: 'files'; files: ChangedFile[] }
  | {
      type: 'results';
      results: FileDiffResult[];
      /** Files that turned out unchanged once formatted. */
      unchanged: string[];
    };

export type PackageDiffResponse =
  | { id: number; type: 'chunk'; chunk: PackageDiffChunk }
  | { id: number; type: 'done' }
  | { id: number; type: 'failure'; failure: PackageDiffFailure };
