'use client';

import * as React from 'react';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter';
import { stringOrHastToJsx, stringOrHastToString } from '@mui/internal-docs-infra/hast';
import { patch, clone } from 'jsondiffpatch';
import { Nodes } from 'hast';
import Switch from '@/components/Switch/Switch';

import '@wooorm/starry-night/style/light';

export function CodeContent(props: ContentProps) {
  const code = props.code?.Default;
  if (!code) {
    return <div>No code available</div>;
  }

  const [showJs, setShowJs] = React.useState(false);
  const toggleJs = React.useCallback(() => {
    setShowJs((prev) => !prev);
  }, []);

  const transform = code.transforms?.js;
  const { source, fileName } = React.useMemo(() => {
    let source = code.source && stringOrHastToJsx(code.source, true);
    let fileName = code.fileName || 'index.js';
    if (transform && showJs) {
      fileName = transform.fileName || fileName;
      if (typeof code.source === 'string') {
        const patched = patch(stringOrHastToString(code.source).split('\n'), transform.delta);
        if (Array.isArray(patched)) {
          source = patched.join('\n');
        }
      } else {
        source = stringOrHastToJsx(patch(clone(code.source), transform.delta) as Nodes, true);
      }
    }

    return { source, fileName };
  }, [code.source, transform, showJs]);

  return (
    <div style={{ border: '1px solid #ccc', borderRadius: '8px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px',
          borderBottom: '1px solid #ccc',
        }}
      >
        <span>{fileName}</span>
        <div style={{ display: transform ? 'flex' : 'none' }}>
          <Switch
            value={showJs}
            onChange={toggleJs}
            options={[
              { label: 'TS', value: false },
              { label: 'JS', value: true },
            ]}
          />
        </div>
      </div>
      <pre style={{ padding: '12px' }}>{source}</pre>
    </div>
  );
}
