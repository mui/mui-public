'use client';

import * as React from 'react';
import { useDemoController } from '@mui/internal-docs-infra/useDemoController';
import type { UseDemoControllerOptions } from '@mui/internal-docs-infra/useDemoController';
import { CodeControllerContext } from '@mui/internal-docs-infra/CodeControllerContext';
import type { CodeControllerProps } from '@mui/internal-docs-infra/CodeControllerContext';

export function DemoController(props: CodeControllerProps<UseDemoControllerOptions>) {
  // @focus-start @padding 1
  // `useDemoController` owns the controlled code, runs each variant's source into a
  // live preview, and collects per-variant errors — returning exactly the shape the
  // controller context expects. A demo reads its variant's error via `useDemo().error`.
  // The factory supplies the demo `url` (the per-demo cross-tab sync key) and any
  // `crossTabSync` opt-out, so forward the whole props object — `children` rides along
  // and is simply ignored by the hook.
  const value = useDemoController(props);

  return (
    <CodeControllerContext.Provider value={value}>{props.children}</CodeControllerContext.Provider>
  );
  // @focus-end
}
