'use client';
import * as React from 'react';
import { useCollapsibleCode } from '@mui/internal-docs-infra/useCollapsibleCode';
import styles from './CollapsibleSnippet.module.css';

const longSource = `function quickSort(arr) {
  if (arr.length <= 1) {
    return arr;
  }
  const pivot = arr[0];
  const left = [];
  const right = [];
  for (let index = 1; index < arr.length; index += 1) {
    if (arr[index] < pivot) {
      left.push(arr[index]);
    } else {
      right.push(arr[index]);
    }
  }
  return [...quickSort(left), pivot, ...quickSort(right)];
}`;

export function CollapsibleSnippet() {
  // @focus-start @padding 1
  const [expanded, setExpanded] = React.useState(false);
  const { containerRef, toggleRef, anchorScroll } = useCollapsibleCode<HTMLButtonElement>();

  const onToggle = () => {
    // Anchor *before* the layout-changing state update.
    anchorScroll(expanded ? 'collapse' : 'expand');
    setExpanded((prev) => !prev);
  };

  return (
    <div ref={containerRef} className={styles.container}>
      <pre className={`${styles.pre} ${expanded ? styles.expanded : ''}`}>
        <code className={styles.code}>{longSource}</code>
      </pre>
      <button ref={toggleRef} type="button" onClick={onToggle} className={styles.toggle}>
        {expanded ? 'Collapse' : 'Expand'}
      </button>
    </div>
  );
  // @focus-end
}
