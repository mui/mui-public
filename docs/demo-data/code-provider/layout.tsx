'use client';

import * as React from 'react';
import { CodeProviderLazy } from '@mui/internal-docs-infra/CodeProvider';
import { createEnhanceCodeEmphasis } from '@mui/internal-docs-infra/pipeline/enhanceCodeEmphasis';

const sourceEnhancers = [
  createEnhanceCodeEmphasis({ paddingFrameMaxSize: 2, focusFramesMaxSize: 18 }),
];

export default function Layout({ children }: { children: React.ReactNode }) {
  return <CodeProviderLazy sourceEnhancers={sourceEnhancers}>{children}</CodeProviderLazy>;
}
