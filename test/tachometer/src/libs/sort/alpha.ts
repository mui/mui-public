import { measureMount } from '../../_shared/measure';
import { SIZE, checksum, makeValues } from './shared';

/** Sorts the boxed array in place, paying a comparator call per comparison. */
measureMount(() => {
  const sorted = makeValues();
  sorted.sort((left, right) => left - right);
  return `libs-sort [alpha] size=${SIZE} checksum=${checksum(sorted).toFixed(3)}`;
});
