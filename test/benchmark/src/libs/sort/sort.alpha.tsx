import * as React from 'react';
import { benchmark } from '@mui/internal-benchmark';
import { makeValues, report } from './shared';

/** Sorts the boxed array in place, paying a comparator call per comparison. */
function Sorted() {
  const values = makeValues();
  values.sort((left, right) => left - right);
  return <p>{report('alpha', values)}</p>;
}

benchmark('sort', () => <Sorted />);
