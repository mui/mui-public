import * as React from 'react';
import { createComponent } from '@toolpad/studio/browser';

const bytesFormat = new Intl.NumberFormat(undefined, {
  style: 'unit',
  maximumSignificantDigits: 3,
  notation: 'compact',
  unit: 'byte',
  unitDisplay: 'narrow',
  signDisplay: 'always',
});

function prettyBytes(value: number) {
  return bytesFormat.format(value);
}

export interface ParsedProps {
  value: number;
}

function formatDiff(value: number): string {
  if (!value) {
    return '';
  }

  const trendIcon = value < 0 ? '▼' : '🔺';

  return `${prettyBytes(value)} ${trendIcon}`;
}

function Diff({ value }: ParsedProps) {
  return <React.Fragment>{formatDiff(value)}</React.Fragment>;
}

export default createComponent(Diff, {
  argTypes: {
    value: {
      type: 'string',
    },
  },
});
