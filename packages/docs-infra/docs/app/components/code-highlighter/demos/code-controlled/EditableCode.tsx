'use client';

import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter';
import { useCode } from '@mui/internal-docs-infra/useCode';

export function EditableCode(props: ContentProps) {
  const { code, onInput } = useCode(props);

  return (
    <div>
      <h2>{props.name}</h2>
      <p>{props.description}</p>
      <pre contentEditable="plaintext-only" onInput={onInput}>
        {code}
      </pre>
    </div>
  );
}
