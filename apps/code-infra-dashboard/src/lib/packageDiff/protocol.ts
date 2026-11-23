import type { DiffOptions, FileDiffResult } from './computePackageDiff';

export interface PackageDiffRequest {
  id: number;
  oldSpec: string;
  newSpec: string;
  options: DiffOptions;
}

export type PackageOutcome = { name: string; version: string } | { error: string };

export interface PackageDiffResult {
  oldPackage: PackageOutcome;
  newPackage: PackageOutcome;
  /** `null` when either package failed to download. */
  files: FileDiffResult[] | null;
}

export type PackageDiffResponse =
  { id: number; result: PackageDiffResult } | { id: number; error: string };
