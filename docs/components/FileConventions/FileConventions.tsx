import * as React from 'react';
import { getFileConventions } from '@mui/internal-docs-infra/pipeline/getFileConventions';
import Link from 'next/link';

export async function FileConventions() {
  const conventions = await getFileConventions();

  return (
    <ul>
      {conventions.map((convention, i) => (
        <li key={i}>
          <code>{convention.rule}</code> -{' '}
          <Link href={`/functions/${convention.loader}`}>{convention.loader}</Link>
        </li>
      ))}
    </ul>
  );
}
