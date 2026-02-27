import * as React from 'react';
import type { Code as CodeType } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { parseImportsAndComments } from '@mui/internal-docs-infra/pipeline/loaderUtils';
import { EMPHASIS_COMMENT_PREFIX } from '@mui/internal-docs-infra/pipeline/enhanceCodeEmphasis';
import { Code } from '../Code';

const source = `import * as React from 'react';
import { formatDate } from './formatDate';
import { fetchEvents } from './fetchEvents';

const today = formatDate(new Date()); // @highlight

export function Calendar() {
  const [events, setEvents] = React.useState([]);

  // @highlight-start @focus
  React.useEffect(() => {
    fetchEvents(today).then(setEvents);
  }, []);
  // @highlight-end

  return (
    <div className="calendar">
      <h2>{today}</h2>
      <ul>
        {events.map((event) => (
          <li key={event.id}>{event.title}</li>
        ))}
      </ul>
    </div>
  );
}`;

export async function FocusCode() {
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
