'use client';

import * as React from 'react';
import { createStarryNight } from '@wooorm/starry-night';
import { CodeContext } from './CodeContext';
import { LoadCodeMeta, LoadSource, LoadVariantMeta, ParseSource } from '../CodeHighlighter';
import { extensionMap, grammars } from '../parseSource/grammars';

export function CodeProvider({
  children,
  loadCodeMeta,
  loadVariantMeta,
  loadSource,
}: {
  children: React.ReactNode;
  loadCodeMeta?: LoadCodeMeta;
  loadVariantMeta?: LoadVariantMeta;
  loadSource?: LoadSource;
}) {
  const sn = React.useRef(createStarryNight(grammars));
  const parseSource = React.useCallback<ParseSource>(async (source: string, fileName: string) => {
    const starryNight = await sn.current;
    const fileType = fileName.slice(fileName.lastIndexOf('.')) || 'plaintext';

    return starryNight.highlight(source, extensionMap[fileType] || 'plaintext');
  }, []);

  const context = React.useMemo(
    () => ({ parseSource, loadSource, loadVariantMeta, loadCodeMeta }),
    [parseSource, loadSource, loadVariantMeta, loadCodeMeta],
  );

  return <CodeContext.Provider value={context}>{children}</CodeContext.Provider>;
}
