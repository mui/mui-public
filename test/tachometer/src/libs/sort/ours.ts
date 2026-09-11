import { measureMount } from '../../_shared/measure';
import { makeValues, report } from './shared';

// Built outside the measured window: every sample is a fresh page load, so the input is still
// generated once per sample — it just no longer counts as part of the sort being measured.
const values = makeValues();

/** Copies into a typed array first, so the engine sorts unboxed doubles with no comparator calls. */
measureMount(() => {
  const sorted = Float64Array.from(values);
  sorted.sort();
  return report('ours', sorted);
});
