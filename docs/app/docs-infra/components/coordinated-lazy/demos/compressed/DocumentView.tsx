import * as React from 'react';
import type { Hoisted } from './documentData';

function SizeRow({
  label,
  bytes,
  note,
  divider,
}: {
  label: string;
  bytes: number;
  note?: string;
  divider?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        ...(divider && { borderTop: '1px solid #d0cdd7', marginTop: 2, paddingTop: 4 }),
      }}
    >
      <span>{label}</span>
      <span style={{ color: '#2c2838' }}>
        {bytes} B{note ? ` · ${note}` : ''}
      </span>
    </div>
  );
}

// Reports the hoisted sizes — the bytes serialized into the page, before any
// HTTP compression. The dictionary (plain prose) is paid for by the fallback
// anyway, so the real comparison is "prose + compressed delta" against
// serializing the whole document uncompressed — and the reused prose still wins.
function SizeBreakdown({ hoisted }: { hoisted: Hoisted }) {
  const serialized = hoisted.plainBytes + hoisted.compressedBytes;
  const saving = Math.round((1 - serialized / hoisted.uncompressedBytes) * 100);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        font: '13px monospace',
        color: '#7c3aed',
      }}
    >
      <SizeRow label="plain prose (dictionary)" bytes={hoisted.plainBytes} />
      <SizeRow label="+ compressed comment delta" bytes={hoisted.compressedBytes} />
      <SizeRow label="= total serialized" bytes={serialized} divider />
      <SizeRow
        label="vs full document, raw"
        bytes={hoisted.uncompressedBytes}
        note={`${saving}% smaller`}
      />
    </div>
  );
}

// The shell both states render: the prose paragraph and the size footer. Sharing
// it keeps the fallback and the content pixel-identical, so only the highlights
// transition across the swap — no layout shift.
export function DocumentView({
  children,
  hoisted,
  footer,
}: {
  children: React.ReactNode;
  hoisted: Hoisted;
  // Override the size footer (e.g. a "comments skipped" note when the comment
  // layer is conditionally not loaded). Defaults to the compression breakdown.
  footer?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
      {/* @focus-start */}
      <p
        style={{
          margin: 0,
          padding: 12,
          lineHeight: 1.6,
          borderRadius: 8,
          border: '1px solid #d0cdd7',
          background: '#faf9fc',
          font: '15px/1.6 Georgia, serif',
          color: '#2c2838',
        }}
      >
        {children}
      </p>
      {footer ?? <SizeBreakdown hoisted={hoisted} />}
      {/* @focus-end */}
    </div>
  );
}
