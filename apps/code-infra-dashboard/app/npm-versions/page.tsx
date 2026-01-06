import * as React from 'react';
import NpmVersions from '../../src/views/NpmVersions';

export default function NpmVersionsPage() {
  return (
    <React.Suspense fallback={null}>
      <NpmVersions />
    </React.Suspense>
  );
}
