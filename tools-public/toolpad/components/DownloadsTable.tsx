import * as React from "react";
import { createComponent } from "@mui/toolpad/browser";
import { DataGrid } from '@mui/x-data-grid';
import { getPackages } from "./NpmChart";

export interface DownloadsTableProps {
  data: any[]
}

const getColumns = (packages) => ([
  { field: 'date', headerName: 'Month', width: 150 },
  ...packages.map(packageName => ({
    field: packageName, headerName: packageName, width: packageName === '@radix-ui/react-primitive' || packageName === '@headlessui/react' ? 170 : 120
  })),
  {field: 'ratio', headerName: "Base UI marketshare", width: 150}
]);

function DownloadsTable({ data: dataProp }: DownloadsTableProps) {
  let data = [...(dataProp ?? [])];

  // @ts-ignore
  let packages = getPackages(data);
  packages = packages.filter(function(item) {
    return item !== '@mui/material' && item !== '@mui/core'
  });

  data = data.map(entry => {
    let headlessLibrariesDownloads = 0;
    Object.keys(entry).forEach(key => {
      if(key !== 'date' && key !== '@mui/base') {
        headlessLibrariesDownloads += entry[key];
      }
    })
    return {
      ...entry,
      // @ts-ignore
      date: entry.date.slice(0, -3),
      // @ts-ignore
      id: entry.date,
      ratio: `${(entry['@mui/base']/headlessLibrariesDownloads * 100).toFixed(2)}%`
    }
  });

  const columns = getColumns(packages);

  return <DataGrid rows={data} columns={columns} />;
}

export default createComponent(DownloadsTable, {
  argTypes: {
    data: {
      typeDef: { type: 'array' }
    }
  },
});
