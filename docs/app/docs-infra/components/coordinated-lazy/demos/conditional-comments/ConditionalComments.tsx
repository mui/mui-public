'use client';
import * as React from 'react';
import {
  CoordinatedLazy,
  LazyContent,
  useCoordinatedContent,
  useCoordinatedFallback,
} from '@mui/internal-docs-infra/CoordinatedLazy';
import { DemoButton } from '@/components/DemoButton/DemoButton';
import { DocumentView } from '../compressed/DocumentView';
import { HOISTED, PROSE, type Hoisted } from '../compressed/documentData';

function ProductionNote() {
  return (
    <div style={{ font: '13px monospace', color: '#3f8f3f' }}>
      production · comments skipped — +0 B over the wire, renderer chunk not loaded
    </div>
  );
}

function Loading() {
  // Always paint the plain prose and hoist it as the dictionary — the cheap layer
  // both deployments share.
  useCoordinatedFallback(HOISTED);
  return (
    <DocumentView hoisted={HOISTED} footer={<ProductionNote />}>
      {PROSE}
    </DocumentView>
  );
}

function ProductionContent() {
  // Reuse the hoisted plaintext — no compressed payload decoded, no comment
  // renderer imported. The full content is the dictionary the fallback already had.
  const hoisted = useCoordinatedContent() as Hoisted;
  return (
    <DocumentView hoisted={hoisted} footer={<ProductionNote />}>
      {hoisted.dictionary}
    </DocumentView>
  );
}

function Toggle({ preview, onChange }: { preview: boolean; onChange: (next: boolean) => void }) {
  const active = { background: '#7c3aed', color: '#fff' };
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <DemoButton style={!preview ? active : undefined} onClick={() => onChange(false)}>
        Production
      </DemoButton>
      <DemoButton style={preview ? active : undefined} onClick={() => onChange(true)}>
        Preview
      </DemoButton>
    </div>
  );
}

export function ConditionalComments() {
  // @focus-start @padding 1
  const [preview, setPreview] = React.useState(false);

  // The fallback hoists the plaintext either way. On the preview path the content
  // is a code-split `LazyContent` that imports the comment renderer and decodes the
  // compressed comments; on production the content just reuses the hoisted
  // plaintext — so neither the payload nor the renderer chunk is ever loaded.
  const content = preview ? (
    <LazyContent content={() => import('./CommentLayerChunk')} />
  ) : (
    <ProductionContent />
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Toggle preview={preview} onChange={setPreview} />
      <CoordinatedLazy ready requireHoist fallback={<Loading />} content={content} />
    </div>
  );
  // @focus-end
}
