import { precomputeDemo } from '../precomputeDemo';
import type { FileDemoDescriptor, PrecomputedFileDemo, PrecomputeFileDemoOptions } from './types';

/** Precomputes a serializable file-backed demo descriptor. */
export async function precomputeFileDemo(
  descriptor: FileDemoDescriptor,
  options: PrecomputeFileDemoOptions = {},
): Promise<PrecomputedFileDemo> {
  const entries = Object.entries(descriptor.entries).map(([name, entry]) => {
    if (entry.name !== name) {
      throw new Error(
        `Demo entry "${name}" has name "${entry.name}"; entry names must match descriptor keys`,
      );
    }
    return entry;
  });
  const precomputed = await precomputeDemo({
    ...options,
    entries,
    ...(descriptor.preview ? { preview: descriptor.preview.source } : {}),
  });
  return { ...precomputed, descriptor };
}
