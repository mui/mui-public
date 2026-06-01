'use client';
import * as React from 'react';
import { CoordinatedLazy, useCoordinatedFallback } from '@mui/internal-docs-infra/CoordinatedLazy';
import { CommentLayer } from './CommentLayer';
import { DocumentView } from './DocumentView';
import { HOISTED, PROSE } from './documentData';

function Loading() {
  // Paint the plain prose and hoist it as the decompression dictionary, along
  // with the byte sizes the content reports. Rendering the same DocumentView the
  // content uses keeps the footer height constant — only the prose transitions.
  useCoordinatedFallback(HOISTED);
  return <DocumentView hoisted={HOISTED}>{PROSE}</DocumentView>;
}

export function CommentedDocument() {
  // @focus-start @padding 1
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    const id = setTimeout(() => setReady(true), 1400);
    return () => clearTimeout(id);
  }, []);

  // `requireHoist` holds the swap until the fallback hoists the prose, so the
  // content always has the dictionary it needs to decode the comments.
  return (
    <CoordinatedLazy ready={ready} requireHoist fallback={<Loading />} content={<CommentLayer />} />
  );
  // @focus-end
}
