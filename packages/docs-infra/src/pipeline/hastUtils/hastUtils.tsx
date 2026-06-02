import type * as React from 'react';
import type { Nodes as HastNodes } from 'hast';
import type { Components } from 'hast-util-to-jsx-runtime';

import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { toText } from 'hast-util-to-text';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { decompressHast } from './hastCompression';
import { fallbackToText, type FallbackNode } from './fallbackFormat';

/**
 * Resolve the DEFLATE dictionary text for a `hastCompressed` payload from a
 * compact `fallback`. The loader compresses each file with its own fallback
 * text as the dictionary (see `loadIsomorphicCodeVariant`), so the same
 * fallback must be supplied here to decode it. Returns `undefined` when no
 * fallback is given (payloads compressed without a dictionary).
 */
function fallbackDictionary(fallback?: FallbackNode[]): string | undefined {
  return fallback ? fallbackToText(fallback) : undefined;
}

export function hastToJsx(hast: HastNodes, components?: Partial<Components>): React.ReactNode {
  return toJsxRuntime(hast, { Fragment, jsx, jsxs, components });
}

export function hastOrJsonToJsx(
  hastOrJson: HastNodes | { hastJson: string } | { hastCompressed: string },
  components?: Partial<Components>,
  fallback?: FallbackNode[],
): React.ReactNode {
  let hast: HastNodes;
  if ('hastJson' in hastOrJson) {
    try {
      hast = JSON.parse(hastOrJson.hastJson);
    } catch (error) {
      throw new Error(`Failed to parse hastJson: ${JSON.stringify(error)}`);
    }
  } else if ('hastCompressed' in hastOrJson) {
    try {
      hast = JSON.parse(decompressHast(hastOrJson.hastCompressed, fallbackDictionary(fallback)));
    } catch (error) {
      throw new Error(`Failed to parse hastCompressed: ${JSON.stringify(error)}`);
    }
  } else {
    hast = hastOrJson;
  }

  return toJsxRuntime(hast, { Fragment, jsx, jsxs, components });
}

export function stringOrHastToString(
  source: string | HastNodes | { hastJson: string } | { hastCompressed: string },
  fallback?: FallbackNode[],
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
  } else if ('hastCompressed' in source) {
    try {
      hast = JSON.parse(decompressHast(source.hastCompressed, fallbackDictionary(fallback)));
    } catch (error) {
      throw new Error(`Failed to parse hastCompressed: ${JSON.stringify(error)}`);
    }
  } else {
    hast = source;
  }

  return toText(hast, { whitespace: 'pre' });
}

export function stringOrHastToJsx(
  source: string | HastNodes | { hastJson: string } | { hastCompressed: string },
  highlighted?: boolean,
  components?: Partial<Components>,
  fallback?: FallbackNode[],
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
  } else if ('hastCompressed' in source) {
    try {
      hast = JSON.parse(decompressHast(source.hastCompressed, fallbackDictionary(fallback)));
    } catch (error) {
      throw new Error(`Failed to parse hastCompressed: ${JSON.stringify(error)}`);
    }
  } else {
    hast = source;
  }

  if (highlighted && typeof hast === 'object') {
    return hastToJsx(hast, components);
  }

  return toText(hast, { whitespace: 'pre' });
}
