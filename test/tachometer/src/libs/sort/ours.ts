import { measureMount } from '../../_shared/measure';
import { SIZE, checksum, makeValues } from './shared';

/** Copies into a typed array first, so the engine sorts unboxed doubles with no comparator calls. */
measureMount(() => {
  const sorted = Float64Array.from(makeValues());
  sorted.sort();
  return `libs-sort [ours] size=${SIZE} checksum=${checksum(Array.from(sorted)).toFixed(3)}`;
});
