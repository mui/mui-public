import * as React from 'react';
import { styled } from '@mui/material/styles';

// Formatters for display in the UI
const displayPercentFormatter = new Intl.NumberFormat(undefined, {
  style: 'percent',
  signDisplay: 'exceptZero',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
});

// Formatter for byte sizes (absolute values) - no sign
export const byteSizeFormatter = new Intl.NumberFormat(undefined, {
  style: 'unit',
  unit: 'byte',
  notation: 'compact',
  unitDisplay: 'narrow',
  maximumSignificantDigits: 3,
  minimumSignificantDigits: 1,
});

// Formatter for size changes - always show sign
// Created by extending the options from byteSizeFormatter
export const byteSizeChangeFormatter = new Intl.NumberFormat(undefined, {
  ...byteSizeFormatter.resolvedOptions(),
  signDisplay: 'exceptZero',
});

// Formatter for exact byte counts (for tooltips) - no sign
export const exactBytesFormatter = new Intl.NumberFormat(undefined, {
  style: 'unit',
  unit: 'byte',
  unitDisplay: 'long',
  useGrouping: true,
});

// Formatter for exact byte changes (for tooltips) - with sign
// Created by extending the options from exactBytesFormatter
export const exactBytesChangeFormatter = new Intl.NumberFormat(undefined, {
  ...exactBytesFormatter.resolvedOptions(),
  signDisplay: 'exceptZero',
});

// Styled components
const Root = styled('span')({
  display: 'inline-flex',
  alignItems: 'center',
});

const ArrowContainer = styled('span')(({ theme }) => ({
  marginRight: theme.spacing(0.5),
  fontWeight: 'bold',
}));

const Content = styled('span')({
  display: 'inline-flex',
  alignItems: 'baseline',
});

const Label = styled('span')(({ theme }) => ({
  marginLeft: theme.spacing(0.5),
  fontSize: '0.85em',
  color: theme.palette.text.secondary,
}));

interface SizeChangeDisplayProps {
  absoluteChange: number;
  relativeChange?: number | null;
}

/**
 * Reusable component for displaying size changes with colored arrows
 * Shows increase/decrease with appropriate colors and formatting
 */
export default function SizeChangeDisplay({
  absoluteChange,
  relativeChange,
}: SizeChangeDisplayProps): React.ReactElement | null {
  if (absoluteChange === 0) {
    return <React.Fragment>No change</React.Fragment>;
  }

  // Format the size in bytes with sign for changes
  const formattedSize = byteSizeChangeFormatter.format(absoluteChange);

  // Determine label and arrow characteristics based on the change
  let label: string | null = null;
  let arrowIcon: string;
  let arrowColor: string;

  if (relativeChange === null) {
    // New bundle
    label = 'new';
    arrowIcon = '▲';
    arrowColor = 'warning.main';
  } else if (relativeChange === -1) {
    // Removed bundle
    label = 'removed';
    arrowIcon = '▼';
    arrowColor = 'info.main';
  } else if (absoluteChange < 0) {
    // Size decrease
    arrowIcon = '▼';
    arrowColor = 'success.main';
    if (Number.isFinite(relativeChange)) {
      label = displayPercentFormatter.format(Number(relativeChange));
    }
  } else {
    // Size increase
    arrowIcon = '▲';
    arrowColor = 'error.main';
    if (Number.isFinite(relativeChange)) {
      label = displayPercentFormatter.format(Number(relativeChange));
    }
  }

  // Format exact bytes for tooltip with sign for changes
  const exactBytes = exactBytesChangeFormatter.format(absoluteChange);

  return (
    <Root title={exactBytes}>
      <ArrowContainer sx={{ color: arrowColor }}>{arrowIcon}</ArrowContainer>
      <Content>
        {formattedSize}
        {label && <Label>({label})</Label>}
      </Content>
    </Root>
  );
}
