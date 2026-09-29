import * as React from 'react';

const ROWS = 1000;

export function UlList() {
  return (
    <ul>
      {Array.from({ length: ROWS }, (_, index) => (
        <li key={index}>
          Row {index} <span>{index % 7}</span>
        </li>
      ))}
    </ul>
  );
}
