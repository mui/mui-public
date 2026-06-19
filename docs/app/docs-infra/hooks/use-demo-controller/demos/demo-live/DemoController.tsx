'use client';

import * as React from 'react';
import { useDemoController } from '@mui/internal-docs-infra/useDemoController';
import { CodeControllerContext } from '@mui/internal-docs-infra/CodeControllerContext';

export function DemoController({ children }: { children: React.ReactNode }) {
  // @focus-start @padding 1
  // `useDemoController` owns the controlled code, runs each variant's source into a
  // live preview, and collects per-variant errors — returning exactly the shape the
  // controller context expects. A demo reads its variant's error via `useDemo().error`.
  const value = useDemoController();

  return <CodeControllerContext.Provider value={value}>{children}</CodeControllerContext.Provider>;
  // @focus-end
}
