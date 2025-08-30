'use client';

import * as React from 'react';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import { createParseSource } from '@mui/internal-docs-infra/pipeline/parseSource';
import { TypescriptToJavascriptTransformer } from '@mui/internal-docs-infra/pipeline/transformTypescriptToJavascript';
import { DemoContent } from '../DemoContent';
import { CustomContentLoading } from './CustomContentLoading';
import { AsyncButton } from './AsyncButton';
import styles from './FallbackDemo.module.css';

export default function FallbackDemo() {
  const [showWithFallback, setShowWithFallback] = React.useState(true);

  return (
    <div>
      <div className={styles.controls}>
        <h4 className={styles.controlsTitle}>Demo Controls</h4>
        <label className={styles.controlsLabel}>
          <input
            type="checkbox"
            checked={showWithFallback}
            onChange={(event) => setShowWithFallback(event.target.checked)}
          />
          Show with loading fallback (toggle to see difference)
        </label>
      </div>
      <CodeHighlighter
        url="file://async-button.tsx"
        components={{ Default: <AsyncButton /> }}
        Content={DemoContent}
        ContentLoading={showWithFallback ? CustomContentLoading : undefined}
        highlightAt="stream"
        sourceParser={createParseSource()}
        sourceTransformers={[TypescriptToJavascriptTransformer]}
        name="Async Button Demo"
      />
    </div>
  );
}
