'use client';

import * as React from 'react';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter';
import { useCode } from '@mui/internal-docs-infra/useCode';
import Switch from '@/components/Switch/Switch';

import '@wooorm/starry-night/style/light';

export function CodeContent(props: ContentProps) {
  const code = useCode(props);

  const hasJsTransform = code.availableTransforms.includes('js');
  const isJsSelected = code.selectedTransform === 'js';

  const toggleJs = React.useCallback(() => {
    code.selectTransform(isJsSelected ? null : 'js');
  }, [code, isJsSelected]);

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
        <span>{code.selectedFileName}</span>
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
      <pre style={{ padding: '12px' }}>{code.selectedFile}</pre>
    </div>
  );
}
