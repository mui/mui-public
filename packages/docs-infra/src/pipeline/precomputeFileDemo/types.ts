import type { DemoEntry, PrecomputedDemo, PrecomputeDemoOptions } from '../precomputeDemo';

export type DemoMetadataValue =
  boolean | number | string | null | DemoMetadataValue[] | { [key: string]: DemoMetadataValue };

export interface DemoPreviewDescriptor {
  /** Exact compatibility preview source. */
  source: string;
  /** Displayed preview file name. */
  fileName?: string;
}

export interface FileDemoDescriptor {
  /** Display name. */
  name: string;
  /** Stable URL-friendly identifier. */
  slug: string;
  /** Source entries keyed by variant name. */
  entries: Record<string, DemoEntry>;
  /** Explicit collapsed source used during compatibility migration. */
  preview?: DemoPreviewDescriptor;
  /** Serializable data owned by the host. */
  metadata?: Record<string, DemoMetadataValue>;
}

export type PrecomputeFileDemoOptions = Omit<PrecomputeDemoOptions, 'entries'>;

export interface PrecomputedFileDemo extends PrecomputedDemo {
  /** Original serializable descriptor. */
  descriptor: FileDemoDescriptor;
}
