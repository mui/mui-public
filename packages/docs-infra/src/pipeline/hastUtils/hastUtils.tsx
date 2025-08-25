import type { Nodes as HastNodes } from 'hast';

import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { toText } from 'hast-util-to-text';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';

export function hastToJsx(hast: HastNodes): React.ReactNode {
  return toJsxRuntime(hast, { Fragment, jsx, jsxs });
}

export function hastOrJsonToJsx(hastOrJson: HastNodes | { hastJson: string }): React.ReactNode {
  let hast: HastNodes;
  if ('hastJson' in hastOrJson) {
    try {
      hast = JSON.parse(hastOrJson.hastJson);
    } catch (error) {
      throw new Error(`Failed to parse hastJson: ${JSON.stringify(error)}`);
    }
  } else {
    hast = hastOrJson;
  }

  return toJsxRuntime(hast, { Fragment, jsx, jsxs });
}

export function stringOrHastToString(source: string | HastNodes | { hastJson: string }): string {
  if (typeof source === 'string') {
    return source;
  }

  let hast: HastNodes;
  if ('hastJson' in source) {
    try {
      hast = JSON.parse(source.hastJson);
    } catch (error) {
      throw new Error(`Failed to parse hastJson: ${JSON.stringify(error)}`);
    }
  } else {
    hast = source;
  }

  return toText(hast, { whitespace: 'pre' });
}

export function stringOrHastToJsx(
  source: string | HastNodes | { hastJson: string },
  highlighted?: boolean,
): React.ReactNode {
  if (typeof source === 'string') {
    return source;
  }

  let hast: HastNodes;
  if ('hastJson' in source) {
    try {
      hast = JSON.parse(source.hastJson);
    } catch (error) {
      throw new Error(`Failed to parse hastJson: ${JSON.stringify(error)}`);
    }
  } else {
    hast = source;
  }

  if (highlighted && typeof hast === 'object') {
    return hastToJsx(hast);
  }

  return toText(hast, { whitespace: 'pre' });
}
