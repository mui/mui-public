import type { Root as HastRoot } from 'hast';
import type { SourceComments, SourceEnhancer, SourceEnhancers } from '../../CodeHighlighter/types';

interface AppliedEnhancersData {
  appliedEnhancers?: string[];
}

function getAppliedEnhancers(root: HastRoot): string[] {
  const data = root.data as AppliedEnhancersData | undefined;
  return data?.appliedEnhancers ?? [];
}

/**
 * Records on the HAST root that an enhancer with this name has been applied,
 * so subsequent passes can skip it. No-op when the enhancer has no
 * `enhancerName`.
 */
export function recordEnhancerApplied(root: HastRoot, enhancer: SourceEnhancer): void {
  const name = enhancer.enhancerName;
  if (!name) {
    return;
  }
  const data = (root.data ?? {}) as AppliedEnhancersData;
  const existing = data.appliedEnhancers;
  if (existing && existing.includes(name)) {
    return;
  }
  root.data = {
    ...data,
    appliedEnhancers: existing ? [...existing, name] : [name],
  } as HastRoot['data'];
}

/**
 * Returns true if the enhancer has a stable name that already appears in
 * `root.data.appliedEnhancers`. Anonymous enhancers (no `enhancerName`) are
 * never skipped.
 */
export function shouldSkipEnhancer(root: HastRoot, enhancer: SourceEnhancer): boolean {
  const name = enhancer.enhancerName;
  if (!name) {
    return false;
  }
  return getAppliedEnhancers(root).includes(name);
}

/**
 * Runs a single enhancer with the skip/record bookkeeping. Returns the
 * (possibly unchanged) root; awaits the enhancer when it returns a promise.
 */
export async function applyEnhancer(
  root: HastRoot,
  comments: SourceComments | undefined,
  fileName: string,
  enhancer: SourceEnhancer,
): Promise<HastRoot> {
  if (shouldSkipEnhancer(root, enhancer)) {
    return root;
  }
  const result = await enhancer(root, comments, fileName);
  recordEnhancerApplied(result, enhancer);
  return result;
}

/**
 * Runs the enhancer pipeline sequentially, skipping any enhancer whose
 * `enhancerName` is already recorded on the HAST root.
 */
export async function applyEnhancers(
  root: HastRoot,
  comments: SourceComments | undefined,
  fileName: string,
  enhancers: SourceEnhancers,
): Promise<HastRoot> {
  let current = root;
  for (const enhancer of enhancers) {
    // eslint-disable-next-line no-await-in-loop
    current = await applyEnhancer(current, comments, fileName, enhancer);
  }
  return current;
}
