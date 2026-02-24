import * as React from 'react';
import type { Code as CodeType } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { parseImportsAndComments } from '@mui/internal-docs-infra/pipeline/loaderUtils';
import { EMPHASIS_COMMENT_PREFIX } from '@mui/internal-docs-infra/pipeline/enhanceCodeEmphasis';
import { Code } from '../Code';

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
    return <p>Loading...</p>;
  }

  return (
    <div>
      <h2>{user.name}</h2>
      <p>{user.email}</p>
    </div>
  );
}`;

export async function CollapsibleCode() {
  const { code: strippedSource, comments } = await parseImportsAndComments(source, '/demo.tsx', {
    removeCommentsWithPrefix: [EMPHASIS_COMMENT_PREFIX],
    notableCommentsPrefix: [EMPHASIS_COMMENT_PREFIX],
  });

  const code: CodeType = {
    Default: {
      language: 'tsx',
      source: strippedSource!,
      comments,
    },
  };

  return <Code code={code} />;
}
