import type { Nodes as HastNodes } from 'hast';

import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { toText } from 'hast-util-to-text';
import { Components, toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { decompressSync, strFromU8 } from 'fflate';
import { decode } from 'uint8-to-base64';

export function hastToJsx(hast: HastNodes, components?: Partial<Components>): React.ReactNode {
  return toJsxRuntime(hast, { Fragment, jsx, jsxs, components });
}

export function hastOrJsonToJsx(
  hastOrJson: HastNodes | { hastJson: string } | { hastGzip: string },
  components?: Partial<Components>,
): React.ReactNode {
  let hast: HastNodes;
  if ('hastJson' in hastOrJson) {
    try {
      hast = JSON.parse(hastOrJson.hastJson);
    } catch (error) {
      throw new Error(`Failed to parse hastJson: ${JSON.stringify(error)}`);
    }
  } else if ('hastGzip' in hastOrJson) {
    try {
      hast = JSON.parse(strFromU8(decompressSync(decode(hastOrJson.hastGzip))));
    } catch (error) {
      throw new Error(`Failed to parse hastGzip: ${JSON.stringify(error)}`);
    }
  } else {
    hast = hastOrJson;
  }

  return toJsxRuntime(hast, { Fragment, jsx, jsxs, components });
}

export function stringOrHastToString(
  source: string | HastNodes | { hastJson: string } | { hastGzip: string },
): string {
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
  } else if ('hastGzip' in source) {
    try {
      hast = JSON.parse(strFromU8(decompressSync(decode(source.hastGzip))));
    } catch (error) {
      throw new Error(`Failed to parse hastGzip: ${JSON.stringify(error)}`);
    }
  } else {
    hast = source;
  }

  return toText(hast, { whitespace: 'pre' });
}

export function stringOrHastToJsx(
  source: string | HastNodes | { hastJson: string } | { hastGzip: string },
  highlighted?: boolean,
  components?: Partial<Components>,
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
  } else if ('hastGzip' in source) {
    try {
      hast = JSON.parse(strFromU8(decompressSync(decode(source.hastGzip))));
    } catch (error) {
      throw new Error(`Failed to parse hastGzip: ${JSON.stringify(error)}`);
    }
  } else {
    hast = source;
  }

  if (highlighted && typeof hast === 'object') {
    return hastToJsx(hast, components);
  }

  return toText(hast, { whitespace: 'pre' });
}
