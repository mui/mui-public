import * as React from 'react';

const ROWS = 1000;

export function TableList() {
  return (
    <table>
      <tbody>
        {Array.from({ length: ROWS }, (_, index) => (
          <tr key={index}>
            <td>Row {index}</td>
            <td>{index % 7}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
