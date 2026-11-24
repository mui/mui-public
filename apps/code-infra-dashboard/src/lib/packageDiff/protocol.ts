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

/**
 * A diff streams in as one `files` response, then `results` in the same order, then `done`.
 * A `null` result is a file that turned out unchanged once formatted.
 */
export type PackageDiffResponse =
  | { id: number; type: 'files'; files: ChangedFile[] }
  | { id: number; type: 'results'; results: [path: string, result: FileDiffResult | null][] }
  | { id: number; type: 'done' }
  | { id: number; type: 'failure'; failure: PackageDiffFailure };
