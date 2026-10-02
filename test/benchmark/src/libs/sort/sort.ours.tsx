import * as React from 'react';
import { makeValues, report } from './shared';

/** Copies into a typed array first, so the engine sorts unboxed doubles with no comparator calls. */
export function OursSorted() {
  const sorted = Float64Array.from(makeValues());
  sorted.sort();
  return <p>{report('ours', sorted)}</p>;
}
