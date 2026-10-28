'use client';
import * as React from 'react';
import { Popover } from '@base-ui/react/popover';
import { compressString } from '@mui/internal-docs-infra/pipeline/hastUtils';

export interface Comment {
  author: string;
  text: string;
}

export interface Line {
  text: string;
  comments?: Comment[];
}

export interface ProseChunk {
  index: number;
  lines: Line[];
}

export const LINES_PER_CHUNK = 5;

// A short generic document in 5-line chunks; a few lines carry review comments.
export const DOCUMENT: ProseChunk[] = [
  {
    index: 0,
    lines: [
      { text: 'The team gathers feedback before each release.' },
      {
        text: 'Small fixes ship the same day they land.',
        comments: [{ author: 'Alice Stone', text: 'Can we link the changelog here?' }],
      },
      { text: 'Larger proposals wait for a second reviewer.' },
      { text: 'Every change is paired with a short rationale.' },
      {
        text: 'Rationales are kept in the shared log.',
        comments: [
          { author: 'Bob Reyes', text: 'Which log — the wiki or the repo?' },
          { author: 'Carol Ng', text: 'The repo; I will add the path.' },
        ],
      },
    ],
  },
  {
    index: 1,
    lines: [
      { text: 'Reviewers focus on intent over style.' },
      { text: 'Style is handled by the formatter on commit.' },
      {
        text: 'Comments should suggest, not block.',
        comments: [{ author: 'Alice Stone', text: 'Unless it is a correctness bug.' }],
      },
      { text: 'Threads close once the author replies.' },
      { text: 'Unresolved threads surface in the digest.' },
    ],
  },
  {
    index: 2,
    lines: [
      {
        text: 'Releases are cut on a weekly cadence.',
        comments: [{ author: 'Carol Ng', text: 'Tuesdays, after the standup.' }],
      },
      { text: 'A draft note collects the week’s changes.' },
      { text: 'Each entry credits its author.' },
      { text: 'The note is published with the tag.' },
      {
        text: 'Hotfixes are noted out of band.',
        comments: [
          { author: 'Bob Reyes', text: 'We should template this.' },
          { author: 'Alice Stone', text: 'Agreed — I’ll draft one.' },
        ],
      },
    ],
  },
  {
    index: 3,
    lines: [
      { text: 'Feedback from users is triaged weekly.' },
      { text: 'Themes are grouped before they are scheduled.' },
      {
        text: 'Quick wins jump the queue.',
        comments: [{ author: 'Carol Ng', text: 'Define “quick” — under a day?' }],
      },
      { text: 'Everything else is sized first.' },
      { text: 'The backlog is pruned every month.' },
    ],
  },
];

export const linesText = (lines: Line[]) => lines.map((line) => line.text).join('\n');

export const byteLength = (value: string) => new TextEncoder().encode(value).length;

// Compress a slice of the document against a plaintext dictionary — the same
// trick the code highlighter uses, applied per chunk or over the whole doc.
export function compressLines(lines: Line[], dictionary: string): string {
  return compressString(JSON.stringify(lines), dictionary);
}

const AVATAR_COLORS = ['#7c3aed', '#3f8f3f', '#d97706', '#0ea5e9'];

// Reserved width at the end of every line for avatars (two overlapped + a count
// badge fit). Plain lines leave it empty so the text column — and therefore line
// wrapping — is identical whether or not a line has comments. No layout shift.
const AVATAR_GUTTER = 64;

function Avatar({ name, index, overlap }: { name: string; index: number; overlap?: boolean }) {
  return (
    <span
      style={{
        boxSizing: 'border-box',
        flex: 'none',
        width: 20,
        height: 20,
        borderRadius: '50%',
        background: AVATAR_COLORS[index % AVATAR_COLORS.length],
        color: '#fff',
        font: '600 11px/17px sans-serif',
        textAlign: 'center',
        display: 'inline-block',
        border: '1.5px solid #fff',
        marginLeft: overlap ? -6 : 0,
      }}
    >
      {name.charAt(0)}
    </span>
  );
}

function CommentLine({ line }: { line: Line }) {
  const comments = line.comments ?? [];
  return (
    <Popover.Root>
      <Popover.Trigger
        render={<div />}
        nativeButton={false}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '2px 6px',
          borderRadius: 4,
          border: 'none',
          background: '#fdf3d0',
          color: 'inherit',
          font: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <span style={{ flex: 1 }}>{line.text}</span>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            flex: 'none',
            width: AVATAR_GUTTER,
          }}
        >
          {comments.map((comment, index) => (
            <Avatar key={comment.author} name={comment.author} index={index} overlap={index > 0} />
          ))}
          {comments.length > 1 && (
            <span
              style={{
                marginLeft: 4,
                minWidth: 16,
                height: 16,
                padding: '0 4px',
                borderRadius: 8,
                background: '#2c2838',
                color: '#fff',
                font: '600 11px/16px sans-serif',
                textAlign: 'center',
              }}
            >
              {comments.length}
            </span>
          )}
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6}>
          <Popover.Popup
            style={{
              maxWidth: 240,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: 12,
              borderRadius: 8,
              background: '#fff',
              border: '1px solid #d0cdd7',
              boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
              font: '13px sans-serif',
            }}
          >
            {comments.map((comment, index) => (
              <div key={comment.author} style={{ display: 'flex', gap: 8 }}>
                <Avatar name={comment.author} index={index} />
                <div>
                  <div style={{ fontWeight: 600 }}>{comment.author}</div>
                  <div style={{ color: '#3f3a4d' }}>{comment.text}</div>
                </div>
              </div>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

// Renders the document lines: a commented line is highlighted and opens its thread
// on click; a plain line is just text. No box chrome — the chunk row frames it.
export function ProseLines({ lines }: { lines: Line[] }) {
  return (
    <React.Fragment>
      {lines.map((line, index) =>
        line.comments && line.comments.length > 0 ? (
          <CommentLine key={index} line={line} />
        ) : (
          <div
            key={index}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 6px' }}
          >
            <span style={{ flex: 1 }}>{line.text}</span>
            {/* Empty gutter matching the avatar safe area so text wraps identically. */}
            <span aria-hidden style={{ flex: 'none', width: AVATAR_GUTTER }} />
          </div>
        ),
      )}
    </React.Fragment>
  );
}

// Width-encoded byte bars: pixels per byte. Per-chunk bars share this scale so
// their lengths are directly comparable; the totals row computes its own.
export const BYTE_SCALE = 0.18;

// Red "warning stripes" for the uncompressed baseline.
const RED_HATCH =
  'repeating-linear-gradient(45deg, #e5484d, #e5484d 5px, #f4b8ba 5px, #f4b8ba 10px)';

function Bar({ width, background, label }: { width: number; background: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div
        style={{ flex: 'none', width: Math.max(width, 2), height: 11, borderRadius: 3, background }}
      />
      <span style={{ color: '#6b6580', whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  );
}

// The three bars beside a chunk: black plaintext, purple compressed comments
// (once they load), and the red hatched baseline — what the same content would
// cost shipped uncompressed (plaintext + raw comments) — with the % saved.
export function ChunkBars({
  plaintextBytes,
  compressedBytes,
  rawBytes,
  richLoaded,
  scale = BYTE_SCALE,
}: {
  plaintextBytes: number;
  compressedBytes: number;
  rawBytes: number;
  richLoaded: boolean;
  scale?: number;
}) {
  const baseline = plaintextBytes + rawBytes;
  const wire = plaintextBytes + (richLoaded ? compressedBytes : 0);
  const saving = baseline > 0 ? Math.round((1 - wire / baseline) * 100) : 0;
  return (
    // Fixed width and an always-present (just-hidden) purple row keep the bar group
    // a constant size, so a chunk loading its comments doesn't shift the layout.
    <div
      style={{
        flex: 'none',
        width: 300,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        paddingTop: 4,
        font: '11px monospace',
      }}
    >
      <Bar
        width={plaintextBytes * scale}
        background="#2c2838"
        label={`plaintext ${plaintextBytes} B`}
      />
      <div style={{ visibility: richLoaded ? 'visible' : 'hidden' }}>
        <Bar
          width={compressedBytes * scale}
          background="#7c3aed"
          label={`comments ${compressedBytes} B`}
        />
      </div>
      <Bar
        width={baseline * scale}
        background={RED_HATCH}
        label={
          richLoaded ? `uncompressed ${baseline} B · −${saving}%` : `uncompressed ${baseline} B`
        }
      />
    </div>
  );
}

// One chunk: the outlined prose box (black = plaintext present; a purple inner
// outline once the comments load) with its size bars to the right.
export function ChunkRow({
  lines,
  plaintextBytes,
  compressedBytes,
  rawBytes,
  richLoaded,
  blackBox,
}: {
  lines: Line[];
  plaintextBytes: number;
  compressedBytes: number;
  rawBytes: number;
  richLoaded: boolean;
  blackBox: boolean;
}) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div
        style={{
          flex: 'none',
          boxSizing: 'border-box',
          width: 260,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          padding: '8px 10px',
          borderRadius: 8,
          background: '#faf9fc',
          border: `2px solid ${blackBox ? '#2c2838' : 'transparent'}`,
          boxShadow: richLoaded ? 'inset 0 0 0 2px #7c3aed' : 'none',
          font: '14px/1.5 Georgia, serif',
          color: '#2c2838',
        }}
      >
        <ProseLines lines={lines} />
      </div>
      <ChunkBars
        plaintextBytes={plaintextBytes}
        compressedBytes={compressedBytes}
        rawBytes={rawBytes}
        richLoaded={richLoaded}
      />
    </div>
  );
}

// The running totals: what has crossed the wire so far (plaintext + compressed
// comments) against the same content shipped raw. `referenceBytes` is the final
// total, so the scale is fixed and the bars visibly grow as chunks accumulate
// rather than re-normalizing each step.
export function Totals({
  plaintextBytes,
  compressedBytes,
  rawBytes,
  referenceBytes,
}: {
  plaintextBytes: number;
  compressedBytes: number;
  rawBytes: number;
  referenceBytes: number;
}) {
  const scale = referenceBytes > 0 ? 220 / referenceBytes : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 4 }}>
      <div style={{ font: '12px monospace', color: '#2c2838', fontWeight: 600 }}>totals</div>
      <ChunkBars
        plaintextBytes={plaintextBytes}
        compressedBytes={compressedBytes}
        rawBytes={rawBytes}
        richLoaded
        scale={scale}
      />
    </div>
  );
}
