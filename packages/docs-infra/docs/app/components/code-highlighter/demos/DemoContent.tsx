'use client';

import * as React from 'react';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter';
import { useDemo } from '@mui/internal-docs-infra/useDemo';
import Switch from '@/components/Switch/Switch';

import '@wooorm/starry-night/style/light';

export function DemoContent(props: ContentProps) {
  const demoHook = useDemo(props);

  if (!props.code?.Default) {
    return <div>No code available</div>;
  }

  const hasJsTransform = demoHook.availableTransforms.includes('js');
  const isJsSelected = demoHook.selectedTransform === 'js';

  const toggleJs = React.useCallback(() => {
    demoHook.selectTransform(isJsSelected ? undefined : 'js');
  }, [demoHook, isJsSelected]);

  return (
    <div style={{ border: '1px solid #ccc', borderRadius: '8px' }}>
      <div style={{ padding: '24px' }}>{props.components?.Default}</div>
      <div style={{ borderTop: '1px solid #ccc' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid #ccc',
            padding: '12px',
          }}
        >
          <span>{demoHook.selectedFileName}</span>
          <div style={{ display: hasJsTransform ? 'flex' : 'none' }}>
            <Switch
              value={isJsSelected}
              onChange={toggleJs}
              options={[
                { label: 'TS', value: false },
                { label: 'JS', value: true },
              ]}
            />
          </div>
        </div>
        <pre style={{ padding: '12px' }}>{demoHook.selectedFile}</pre>
      </div>
    </div>
  );
}
