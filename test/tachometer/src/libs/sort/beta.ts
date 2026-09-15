import { measureMount } from '../../_shared/measure';
import { makeValues, report } from './shared';

const values = makeValues();

/** A merge sort written in JavaScript, allocating as it goes — the slow variant of the three. */
function mergeSort(values: number[]): number[] {
  if (values.length <= 1) {
    return values;
  }
  const middle = Math.floor(values.length / 2);
  const left = mergeSort(values.slice(0, middle));
  const right = mergeSort(values.slice(middle));

  const merged: number[] = new Array(values.length);
  let leftIndex = 0;
  let rightIndex = 0;
  for (let index = 0; index < merged.length; index += 1) {
    if (
      leftIndex < left.length &&
      (rightIndex >= right.length || left[leftIndex] <= right[rightIndex])
    ) {
      merged[index] = left[leftIndex];
      leftIndex += 1;
    } else {
      merged[index] = right[rightIndex];
      rightIndex += 1;
    }
  }
  return merged;
}

measureMount(() => report('beta', mergeSort(values)));
