'use client';

import * as React from 'react';
import { CodeHighlighter } from '@mui/internal-docs-infra/CodeHighlighter';
import { parseSourceFactory } from '@mui/internal-docs-infra/parseSource';
import { TsToJsTransformer } from '@mui/internal-docs-infra/transformTsToJs';
import { CodeContent } from '../CodeContent';
import styles from './ControlledCode.module.css';

export default function ControlledCode() {
  const [code, setCode] = React.useState(`function greet(name) {
  return \`Hello, \${name}!\`;
}

console.log(greet('World'));`);

  const [fileName, setFileName] = React.useState('greeting.js');

  const codeData = {
    Default: {
      url: 'file://controlled.js',
      fileName,
      source: code,
    },
  };

  return (
    <div className={styles.controlContainer}>
      <div className={styles.controlsPanel}>
        <h3 className={styles.controlsTitle}>Controls</h3>
        <div className={styles.controlRow}>
          <label>
            File name:
            <input type="text" value={fileName} onChange={(e) => setFileName(e.target.value)} />
          </label>
        </div>
        <div>
          <label className={styles.textareaLabel}>Code:</label>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={styles.codeTextarea}
          />
        </div>
      </div>

      <CodeHighlighter
        url="file://controlled.js"
        code={codeData}
        Content={CodeContent}
        controlled
        sourceParser={parseSourceFactory()}
        sourceTransformers={[TsToJsTransformer]}
      />
    </div>
  );
}
