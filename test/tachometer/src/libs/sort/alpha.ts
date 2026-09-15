import { measureMount } from '../../_shared/measure';
import { makeValues, report } from './shared';

const values = makeValues();

/** Sorts the boxed array in place, paying a comparator call per comparison. */
measureMount(() => {
  values.sort((left, right) => left - right);
  return report('alpha', values);
});
