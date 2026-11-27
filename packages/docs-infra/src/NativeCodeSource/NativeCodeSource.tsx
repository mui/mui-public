'use client';

import * as React from 'react';
import { CodeEditor } from '../useCode/CodeEditor';
import { Pre } from '../useCode/Pre';
import type { CodeSourceProps } from '../useCode/Pre';

/** Renders the native editor from the initial source and binds editing in place. */
export function NativeCodeSource(props: CodeSourceProps) {
  return <Pre {...props} NativeEditor={CodeEditor} />;
}
