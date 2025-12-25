import * as React from 'react';
import { DataGrid, GridColDef } from '@mui/x-data-grid-v8';
import { createComponent } from '@toolpad/studio/browser';

export interface AutoDataGridProps {
  rows: any[];
  loading?: boolean;
}

function AutoDataGrid(props: AutoDataGridProps) {
  const columns = React.useMemo<GridColDef[]>(() => {
    if (!props.rows || props.rows.length === 0) {
      return [];
    }

    const firstRow = props.rows[0];
    return Object.keys(firstRow).map((key) => {
      const value = firstRow[key];
      let type: 'string' | 'number' | 'boolean' | 'dateTime' | 'date' = 'string';

      if (typeof value === 'number') {
        type = 'number';
      } else if (typeof value === 'boolean') {
        type = 'boolean';
      } else if (value instanceof Date) {
        type = 'dateTime';
      }

      return {
        field: key,
        width: 150,
        type,
      };
    });
  }, [props.rows]);

  const rowsWithId = React.useMemo(() => {
    return props.rows.map((row, index) => {
      return { ...row, id: index };
    });
  }, [props.rows]);

  return (
    <div style={{ height: 500, width: '100%' }}>
      <DataGrid
        rows={rowsWithId}
        columns={columns}
        loading={props.loading}
        disableRowSelectionOnClick
        density="compact"
      />
    </div>
  );
}

export default createComponent(AutoDataGrid, {
  argTypes: {
    rows: {
      type: 'array',
      default: [],
    },
  },
  loadingPropSource: ['rows'],
  loadingProp: 'loading',
});
