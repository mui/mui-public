export type SizeSnapshotEntry = { parsed: number; gzip: number };
export type SizeSnapshot = Record<string, SizeSnapshotEntry>;

export interface SizeSnapshotMetadata {
  trackedBundles?: string[];
}

export type SizeSnapshotWithMetadata = SizeSnapshot & {
  _metadata?: SizeSnapshotMetadata;
};
