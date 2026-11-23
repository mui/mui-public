import type { DiffOptions, FileDiffResult } from './computePackageDiff';

export interface PackageDiffRequest {
  id: number;
  oldSpec: string;
  newSpec: string;
  options: DiffOptions;
}

export interface PackageDiffFailure {
  message: string;
  /** Why the old package couldn't be downloaded, if it couldn't. */
  oldError?: string;
  /** Why the new package couldn't be downloaded, if it couldn't. */
  newError?: string;
}

export type PackageDiffResponse =
  { id: number; files: FileDiffResult[] } | { id: number; failure: PackageDiffFailure };
