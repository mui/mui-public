'use client';

import * as React from 'react';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter';
import { useDemo } from '@mui/internal-docs-infra/useDemo';
import Switch from '@/components/Switch/Switch';

import '@wooorm/starry-night/style/light';

export function DemoContent(props: ContentProps) {
  const demo = useDemo(props);

  const hasJsTransform = demo.availableTransforms.includes('js');
  const isJsSelected = demo.selectedTransform === 'js';

  const toggleJs = React.useCallback(() => {
    demo.selectTransform(isJsSelected ? null : 'js');
  }, [demo, isJsSelected]);

  return (
    <div style={{ border: '1px solid #ccc', borderRadius: '8px' }}>
      <div style={{ padding: '24px' }}>{demo.component}</div>
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
          <span>{demo.selectedFileName}</span>
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
        <pre style={{ padding: '12px' }}>{demo.selectedFile}</pre>
      </div>
    </div>
  );
}
