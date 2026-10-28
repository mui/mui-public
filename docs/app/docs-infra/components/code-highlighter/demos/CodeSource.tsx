import * as React from 'react';
import styles from './CodeSource.module.css';

import './syntax.css';

/**
 * Presentational wrapper that applies the frame / line / highlight (emphasis)
 * styling to a rendered block of highlighted code.
 *
 * It owns no collapse, scroll, or layout behavior — wrap it in a container that
 * adds padding, borders, or a collapse/expand toggle. Pass the rendered `<pre>`
 * (e.g. `code.selectedFile` from `useCode`) as children; layer container styles
 * (padding, overflow, fade overlays) onto the same element via `className`.
 */
export function CodeSource({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    // @focus-start
    <div className={className ? `${styles.source} ${className}` : styles.source}>{children}</div>
    // @focus-end
  );
}
