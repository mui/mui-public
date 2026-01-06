import * as React from 'react';
import RepositoryLayout from '../../../../src/views/RepositoryLayout';

export default function RepoLayout({ children }: { children: React.ReactNode }) {
  return <RepositoryLayout>{children}</RepositoryLayout>;
}
