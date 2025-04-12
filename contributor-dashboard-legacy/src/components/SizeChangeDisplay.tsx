import * as React from 'react';
import { styled } from '@mui/material/styles';

// Formatters for display in the UI
const displayPercentFormatter = new Intl.NumberFormat('en-US', {
  style: 'percent',
  signDisplay: 'exceptZero',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
});

// Formatter for byte sizes
const byteSizeFormatter = new Intl.NumberFormat('en-US', {
  style: 'unit',
  signDisplay: 'exceptZero',
  unit: 'kilobyte',
  unitDisplay: 'short',
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
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
  relativeChange?: number;
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

  // Convert bytes to kilobytes and format
  const sizeInKB = Math.abs(absoluteChange) / 1024;
  const formattedSize = byteSizeFormatter.format(sizeInKB);

  // Determine label and arrow characteristics based on the change
  let label: string | null = null;
  let arrowIcon: string;
  let arrowColor: string;

  if (relativeChange === Infinity) {
    // New bundle
    label = 'new';
    arrowIcon = '▲';
    arrowColor = 'warning.main';
  } else if (relativeChange === -Infinity) {
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

  return (
    <Root>
      <ArrowContainer sx={{ color: arrowColor }}>{arrowIcon}</ArrowContainer>
      <Content>
        {formattedSize}
        {label && <Label>({label})</Label>}
      </Content>
    </Root>
  );
}
