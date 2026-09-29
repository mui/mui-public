import * as React from 'react';
import { makeValues, report } from './shared';

/** Sorts the boxed array in place, paying a comparator call per comparison. */
export function AlphaSorted() {
  const values = makeValues();
  values.sort((left, right) => left - right);
  return <p>{report('alpha', values)}</p>;
}
