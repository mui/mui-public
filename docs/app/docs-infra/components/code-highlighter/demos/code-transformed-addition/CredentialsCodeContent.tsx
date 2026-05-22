'use client';

import * as React from 'react';
import { Checkbox } from '@base-ui/react/checkbox';
import type { ContentProps } from '@mui/internal-docs-infra/CodeHighlighter/types';
import { useCode } from '@mui/internal-docs-infra/useCode';
import { CodeBlockHeader, CodeBlockHeaderLabel } from '../CodeBlockHeader';
import styles from '../CodeContent.module.css';
import toggleStyles from './CredentialsToggle.module.css';

import '../syntax.css';

const TRANSFORM_NAME = 'withKey';

/**
 * Demo-specific Content with a pill-shaped "Include credentials" toggle
 * that selects the `withKey` transform (added by `AddApiKeyTransformer`).
 * Starts with the transform applied via `initialTransform` so users see
 * the injected `const API_KEY = '...'` lines on first paint, then can
 * toggle the switch to watch them animate out and back in.
 */
export function CredentialsCodeContent(props: ContentProps<object>) {
  // @focus-start @padding 1
  const code = useCode(props, {
    preClassName: styles.codeBlock,
    transformDelay: 350,
    initialTransform: TRANSFORM_NAME,
  });

  const hasTransform = code.availableTransforms.includes(TRANSFORM_NAME);
  const isEnabled = code.selectedTransform === TRANSFORM_NAME;

  const onCheckedChange = React.useCallback(
    (checked: boolean) => {
      code.selectTransform(checked ? TRANSFORM_NAME : null);
    },
    [code],
  );

  return (
    <div className={styles.container}>
      <CodeBlockHeader
        roundedTop
        pending={code.pendingTransform}
        menu={
          hasTransform ? (
            <span className={toggleStyles.toggle}>
              <Checkbox.Root
                checked={isEnabled}
                onCheckedChange={onCheckedChange}
                className={toggleStyles.checkbox}
                aria-label="Include credentials"
              >
                <Checkbox.Indicator className={toggleStyles.indicator}>
                  <CheckIcon />
                </Checkbox.Indicator>
              </Checkbox.Root>
              <span className={toggleStyles.label} aria-hidden="true">
                Include credentials
              </span>
            </span>
          ) : undefined
        }
      >
        <CodeBlockHeaderLabel>{code.selectedFileName}</CodeBlockHeaderLabel>
      </CodeBlockHeader>
      <div className={styles.code}>{code.selectedFile}</div>
    </div>
  );
  // @focus-end
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path
        d="M1.5 5.5L4 8L8.5 2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
