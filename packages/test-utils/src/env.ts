import * as React from 'react';

export function isJsdom() {
  return window.navigator.userAgent.includes('jsdom');
}

export const reactMajor = parseInt(React.version, 10);

/**
 * Set to true if console logs during [lifecycles that are invoked twice in `React.StrictMode`](https://reactjs.org/docs/strict-mode.html#detecting-unexpected-side-effects) are suppressed.
 * Useful for asserting on `console.warn` or `console.error` via `toErrorDev()`.
 * TODO: Refactor to use reactMajor when fixing the React 17 cron test.
 * https://github.com/mui/material-ui/issues/43153
 */
export const strictModeDoubleLoggingSuppressed = reactMajor === 17;
