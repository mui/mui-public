import { TypesMeta, useTypes } from '@mui/internal-docs-infra/useTypes';
import styles from './TypesTable.module.css';

export type TypesTableProps = TypesMeta & {
  size: 'small' | 'medium' | 'large';
  name?: string;
  displayName?: string;
};

export function TypesTable(props: TypesTableProps) {
  const { types } = useTypes(props);

  return <div className={styles.root}>{types && JSON.stringify(types, null, 2)}</div>;
}
