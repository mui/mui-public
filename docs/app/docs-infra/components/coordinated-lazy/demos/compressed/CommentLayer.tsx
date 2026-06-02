'use client';
import * as React from 'react';
import { Popover } from '@base-ui/react/popover';
import { useCoordinatedContent } from '@mui/internal-docs-infra/CoordinatedLazy';
import { decompressString } from '@mui/internal-docs-infra/pipeline/hastUtils';
import { DocumentView } from './DocumentView';
import {
  COMPRESSED,
  type Comment,
  type DocumentRoot,
  type Hoisted,
  type MarkNode,
  type TextNode,
} from './documentData';

const AVATAR_COLORS = ['#7c3aed', '#3f8f3f', '#d97706', '#0ea5e9'];

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

// A commented span: highlighted text that reveals its commenters' avatars on
// hover and opens the full thread in a popover on click.
function CommentMark({ comments, children }: { comments: Comment[]; children: React.ReactNode }) {
  const [hovered, setHovered] = React.useState(false);
  return (
    <Popover.Root>
      <span
        style={{ position: 'relative', display: 'inline' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <Popover.Trigger
          // Render as an inline <mark> with no padding so the highlight occupies
          // exactly the same space as the plain fallback text — no layout shift.
          // `nativeButton={false}` tells Base UI to apply button semantics to the
          // non-<button> element instead of expecting a real one.
          render={<mark />}
          nativeButton={false}
          style={{
            font: 'inherit',
            color: 'inherit',
            background: '#fde68a',
            borderRadius: 3,
            cursor: 'pointer',
            boxDecorationBreak: 'clone',
            WebkitBoxDecorationBreak: 'clone',
          }}
        >
          {children}
        </Popover.Trigger>
        {hovered && (
          <span
            style={{
              position: 'absolute',
              bottom: '100%',
              left: 0,
              marginBottom: 4,
              display: 'flex',
              alignItems: 'center',
              pointerEvents: 'none',
            }}
          >
            {comments.map((comment, index) => (
              <Avatar
                key={comment.author}
                name={comment.author}
                index={index}
                overlap={index > 0}
              />
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
        )}
      </span>
      <Popover.Portal>
        <Popover.Positioner sideOffset={8}>
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

function renderNodes(nodes: Array<TextNode | MarkNode>): React.ReactNode {
  return nodes.map((node, index) => {
    if (node.type === 'text') {
      return node.value;
    }
    return (
      <CommentMark key={index} comments={node.properties.comments}>
        {renderNodes(node.children)}
      </CommentMark>
    );
  });
}

// The content half of the swap: it decodes the compressed comment layer against
// the dictionary the fallback hoisted and renders the marks with their threads.
export function CommentLayer() {
  // @focus-start @padding 1
  const hoisted = useCoordinatedContent() as Hoisted;
  const document = React.useMemo<DocumentRoot>(
    () => JSON.parse(decompressString(COMPRESSED, hoisted.dictionary)),
    [hoisted.dictionary],
  );
  return <DocumentView hoisted={hoisted}>{renderNodes(document.children)}</DocumentView>;
  // @focus-end
}
