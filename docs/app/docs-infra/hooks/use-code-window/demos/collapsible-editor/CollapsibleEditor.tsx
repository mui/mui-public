import 'server-only';

import * as React from 'react';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import type { Code as CodeType } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { createParseSource } from '@mui/internal-docs-infra/pipeline/parseSource';
import {
  createEnhanceCodeEmphasis,
  EMPHASIS_COMMENT_PREFIX,
} from '@mui/internal-docs-infra/pipeline/enhanceCodeEmphasis';
import { parseImportsAndComments } from '@mui/internal-docs-infra/pipeline/loaderUtils';

import { CollapsibleContentLazy } from '../CollapsibleContentLazy';
import { CollapsibleContentLoading } from '../CollapsibleContentLoading';
import { CodeController } from './CodeController';

const sourceParser = createParseSource();
const sourceEnhancers = [createEnhanceCodeEmphasis({ paddingFrameMaxSize: 3 })];

// A source long enough (and indented) to collapse into a windowed view with a
// clipped indent gutter. The `@highlight` block becomes the focused/visible
// region while collapsed; the surrounding lines are clipped.
const source = `import * as React from 'react';
import { fetchUser } from './api';

interface User {
  name: string;
  email: string;
}

export function UserProfile({ id }: { id: string }) {
  const [user, setUser] = React.useState<User | null>(null);

  // @highlight-start
  React.useEffect(() => {
    let cancelled = false;
    fetchUser(id).then((data) => {
      if (!cancelled) {
        setUser(data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id]);
  // @highlight-end

  if (!user) {
    return <p>Loading…</p>;
  }

  return (
    <div>
      <h2>{user.name}</h2>
      <p>{user.email}</p>
    </div>
  );
}`;

/**
 * A collapsible code block that is ALSO editable — the combination needed to
 * reproduce the collapsed-window editing bugs (last-indent erase jump, ArrowUp
 * scroll anchor). It reuses the collapsible `CollapsibleContent` (which owns the
 * `useCodeWindow` collapse + the expand checkbox) and turns on editing by
 * wrapping it in a `CodeController` and passing `controlled` to the highlighter.
 */
export async function CollapsibleEditor() {
  // @focus-start @padding 1
  const { code: strippedSource, comments } = await parseImportsAndComments(source, '/demo.tsx', {
    removeCommentsWithPrefix: [EMPHASIS_COMMENT_PREFIX],
    notableCommentsPrefix: [EMPHASIS_COMMENT_PREFIX],
  });

  const code: CodeType = {
    Default: {
      fileName: 'UserProfile.tsx',
      language: 'tsx',
      source: strippedSource!,
      comments,
    },
  };

  return (
    <CodeController>
      <CodeHighlighter
        code={code}
        controlled
        Content={CollapsibleContentLazy}
        ContentLoading={CollapsibleContentLoading}
        sourceParser={sourceParser}
        sourceEnhancers={sourceEnhancers}
      />
    </CodeController>
  );
  // @focus-end
}
