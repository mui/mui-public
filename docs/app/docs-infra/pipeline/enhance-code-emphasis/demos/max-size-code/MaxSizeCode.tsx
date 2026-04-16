import * as React from 'react';
import type { Code as CodeType } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { parseImportsAndComments } from '@mui/internal-docs-infra/pipeline/loaderUtils';
import { EMPHASIS_COMMENT_PREFIX } from '@mui/internal-docs-infra/pipeline/enhanceCodeEmphasis';
import { CodeMaxSize } from '../CodeMaxSize';

const source = `import * as React from 'react';

interface FormData {
  name: string;
  email: string;
  message: string;
}

export function ContactForm() {
  const [form, setForm] = React.useState<FormData>({
    name: '',
    email: '',
    message: '',
  });

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const response = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (!response.ok) {
      throw new Error('Failed to submit');
    }
    setForm({ name: '', email: '', message: '' });
  };

  return (
    // @highlight-start
    <form onSubmit={handleSubmit}>
      <label htmlFor="name">Name</label>
      <input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <label htmlFor="email">Email</label>
      <input id="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      <label htmlFor="message">Message</label>
      <textarea id="message" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
      <button type="submit">Send</button>
    </form>
    // @highlight-end
  );
}`;

export async function MaxSizeCode() {
  // @focus-start @padding 1
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

  return <CodeMaxSize code={code} />;
  // @focus-end
}
