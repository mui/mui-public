import * as React from 'react';
import { expect, it } from 'vitest';
import { runCase, ScalarMetric } from '@mui/internal-benchmark';

function List({ count }: { count: number }) {
  return (
    <ul>
      {Array.from({ length: count }, (_, index) => (
        <li key={index}>Item {index}</li>
      ))}
    </ul>
  );
}

const cases = [
  { label: 'list-100', renderFn: () => <List count={100} /> },
  { label: 'list-200', renderFn: () => <List count={200} /> },
];

const iterationDuration = new ScalarMetric({
  name: 'driver_iteration',
  format: { style: 'unit', unit: 'millisecond', maximumFractionDigits: 2 },
});

// A driver of its own: alternates the cases iteration by iteration instead of in blocks, warming
// each one up right before it is measured.
it('driver: interleaves cases', async () => {
  for (let i = 0; i < 5; i += 1) {
    for (const { label, renderFn } of cases) {
      // eslint-disable-next-line no-await-in-loop
      await runCase(renderFn, { warmup: true });

      iterationDuration.time(label);
      // eslint-disable-next-line no-await-in-loop
      const result = await runCase(renderFn);
      iterationDuration.timeEnd(label);

      expect(result.renderError).toBe(null);
      expect(result.renders.map((render) => render.phase)).toEqual(['mount']);
    }
  }
});
