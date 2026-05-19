import * as React from 'react';
import { benchmark, ElementTiming } from '@mui/internal-benchmark';

const rows = Array.from({ length: 200 }, (_, i) => ({
  id: i,
  name: `Row ${i}`,
  value: Math.sqrt(i).toFixed(4),
}));

function DataGrid() {
  return (
    <table>
      <thead>
        <tr>
          <th>
            Name
            <ElementTiming name="grid-header" />
          </th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={row.id}>
            <td>
              {row.name}
              {index === 0 ? <ElementTiming name="grid-body" /> : null}
            </td>
            <td>{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

benchmark(
  'DataGrid mount with paint timing',
  () => <DataGrid />,
  async ({ waitForElementTiming }) => {
    await Promise.all([waitForElementTiming('grid-header'), waitForElementTiming('grid-body')]);
  },
  {
    runs: 10,
    warmupRuns: 5,
  },
);
