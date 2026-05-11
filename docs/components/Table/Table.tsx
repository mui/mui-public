import * as React from 'react';
import styles from './Table.module.css';

type TableProps = React.ComponentProps<'table'>;

export function Table({ className, ...rest }: TableProps) {
  const mergedClassName = [styles.root, className].filter(Boolean).join(' ');
  return <table {...rest} className={mergedClassName} />;
}
