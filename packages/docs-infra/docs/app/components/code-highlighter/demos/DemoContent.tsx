'use client';

import * as React from 'react';
import { stringOrHastToJsx, stringOrHastToString } from '@mui/internal-docs-infra/hast';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter';
import { patch, clone } from 'jsondiffpatch';
import type { Nodes } from 'hast';
import Switch from '@/components/Switch/Switch';

import '@wooorm/starry-night/style/light';

export function DemoContent(props: ContentProps) {
  const code = props.code?.Default;
  if (!code) {
    return <div>No code available</div>;
  }

  const [showJs, setShowJs] = React.useState(false);
  const toggleJs = React.useCallback(() => {
    setShowJs((prev) => !prev);
  }, []);

  const delta = code.transforms?.js?.delta;
  const shownSource = React.useMemo(() => {
    let source = code.source && stringOrHastToJsx(code.source, true);
    if (delta && showJs) {
      if (typeof code.source === 'string') {
        const patched = patch(stringOrHastToString(code.source).split('\n'), delta);
        if (Array.isArray(patched)) {
          source = patched.join('\n');
        }
      } else {
        source = stringOrHastToJsx(patch(clone(code.source), delta) as Nodes, true);
      }
    }

    return source;
  }, [code.source, code.transforms?.js?.delta, showJs]);

  return (
    <div style={{ border: '1px solid #ccc', borderRadius: '8px' }}>
      <div style={{ padding: '24px' }}>{props.components?.Default}</div>
      <div style={{ borderTop: '1px solid #ccc', padding: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ textDecoration: 'underline' }}>{code.fileName}</span>
          <div style={{ display: delta ? 'flex' : 'none' }}>
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
        <pre>{shownSource}</pre>
      </div>
    </div>
  );
}
