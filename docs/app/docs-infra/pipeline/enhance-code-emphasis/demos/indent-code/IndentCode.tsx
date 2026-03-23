import * as React from 'react';
import type { Code as CodeType } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { parseImportsAndComments } from '@mui/internal-docs-infra/pipeline/loaderUtils';
import { EMPHASIS_COMMENT_PREFIX } from '@mui/internal-docs-infra/pipeline/enhanceCodeEmphasis';
import { CodeIndent } from '../CodeIndent';

const source = `import * as React from 'react';
import { DatePicker } from './DatePicker'; // @highlight

export function ScheduleView() {
  const [date, setDate] = React.useState(null);

  return (
    <main>
      <header>
        <h1>Schedule</h1>
      </header>
      <section>
        <form>
          <label htmlFor="date">Pick a date</label>
          {/* @highlight-start @focus */}
          <DatePicker
            id="date"
            value={date}
            onChange={setDate}
            minDate={new Date()}
            format="MM/dd/yyyy"
          />
          {/* @highlight-end */}
        </form>
      </section>
      <footer>
        <p>All times shown in UTC</p>
      </footer>
    </main>
  );
}`;

export async function IndentCode() {
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

  return <CodeIndent code={code} />;
}
