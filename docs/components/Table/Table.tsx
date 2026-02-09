import * as React from 'react';
import styles from './Table.module.css';

type TableProps = React.ComponentProps<'table'>;

export function Table(props: TableProps) {
  return <table {...props} className={styles.root} />;
}
