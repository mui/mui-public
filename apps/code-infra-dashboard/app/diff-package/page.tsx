import * as React from 'react';
import DiffPackage from '../../src/views/DiffPackage';

export default function DiffPackagePage() {
  return (
    <React.Suspense fallback={null}>
      <DiffPackage />
    </React.Suspense>
  );
}
