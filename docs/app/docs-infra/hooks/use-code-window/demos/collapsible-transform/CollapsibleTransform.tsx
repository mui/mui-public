import * as React from 'react';
import type { Code as CodeType } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { parseImportsAndComments } from '@mui/internal-docs-infra/pipeline/loaderUtils';
import {
  EMPHASIS_COMMENT_PREFIX,
  FOCUS_COMMENT_PREFIX,
} from '@mui/internal-docs-infra/pipeline/enhanceCodeEmphasis';
import { TypescriptToJavascriptTransformer } from '@mui/internal-docs-infra/pipeline/transformTypescriptToJavascript';
import { Code } from '../Code';

const source = `import * as React from 'react';

interface User {
  id: string;
  name: string;
  email: string;
}

interface UserListProps {
  users: User[];
  onSelect: (user: User) => void;
}

// @focus-start
export function UserList({ users, onSelect }: UserListProps) {
  const [query, setQuery] = React.useState<string>('');

  const filtered = users.filter((user: User) =>
    user.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <ul>
      {filtered.map((user: User) => (
        <li key={user.id} onClick={() => onSelect(user)}>
          {user.name}
        </li>
      ))}
    </ul>
  );
}
// @focus-end`;

const sourceTransformers = [TypescriptToJavascriptTransformer];

export async function CollapsibleTransform() {
  // @focus-start @padding 1
  const { code: strippedSource, comments } = await parseImportsAndComments(
    source,
    '/UserList.tsx',
    {
      removeCommentsWithPrefix: [FOCUS_COMMENT_PREFIX],
      notableCommentsPrefix: [FOCUS_COMMENT_PREFIX],
    },
  );

  const code: CodeType = {
    Default: {
      fileName: 'UserList.tsx',
      language: 'tsx',
      source: strippedSource!,
      comments,
    },
  };

  return <Code code={code} sourceTransformers={sourceTransformers} />;
  // @focus-end
}
