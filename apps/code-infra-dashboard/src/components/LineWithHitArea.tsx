import * as React from 'react';
import { AnimatedLineProps } from '@mui/x-charts-pro';

/**
 * A line chart path component with an extended invisible hit area for easier hover interaction.
 * Renders two paths:
 * 1. The visible styled line that responds to highlight state
 * 2. A wider transparent path that captures mouse events
 *
 * @see https://github.com/mui/mui-x/pull/18539
 */
export function LineWithHitArea(props: AnimatedLineProps): React.ReactElement {
  const { d, ownerState, className, ...other } = props;

  return (
    <React.Fragment>
      <path
        d={d}
        stroke={ownerState.gradientId ? `url(#${ownerState.gradientId})` : ownerState.color}
        strokeWidth={ownerState.isHighlighted ? 4 : 2}
        strokeLinejoin="round"
        fill="none"
        filter={ownerState.isHighlighted ? 'brightness(120%)' : undefined}
        opacity={ownerState.isFaded ? 0.3 : 1}
        className={className}
      />
      <path
        d={d}
        stroke="transparent"
        strokeWidth={25}
        fill="none"
        className="interaction-area"
        {...other}
      />
    </React.Fragment>
  );
}
