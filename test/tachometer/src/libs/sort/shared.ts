/**
 * The workload the three variants share, so they differ only in how they sort.
 *
 * This case stands in for a cross-library comparison: the shape where every variant is built from
 * the *same* commit, and the difference worth knowing is between implementations rather than
 * between two builds of ours. This repository has no competitor libraries to install, so the
 * "libraries" here are three sorts with genuinely different constant factors.
 */

/** Values per sample. Large enough that the sort, not the page load, dominates the measurement. */
export const SIZE = 100_000;

/** A small linear congruential generator, so every sample sorts identical input. */
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 0x100000000;
    return state / 0x100000000;
  };
}

/** A fresh unsorted array. Fresh per sample: re-sorting a sorted array measures something else. */
export function makeValues(): number[] {
  const random = createRandom(42);
  const values: number[] = new Array(SIZE);
  for (let index = 0; index < SIZE; index += 1) {
    values[index] = random();
  }
  return values;
}

/**
 * A checksum that depends on the order, so a variant that returned an unsorted or truncated array
 * could not quietly report the same number as one that sorted correctly.
 */
export function checksum(values: readonly number[]): number {
  let total = 0;
  for (let index = 0; index < values.length; index += 1) {
    total += values[index] * index;
  }
  return total;
}
