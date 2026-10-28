import { transformSync } from '@babel/core';
import { describe, expect, it } from 'vitest';

import { getBaseConfig } from './babel-config.mjs';

/**
 * @param {string} code
 * @param {string} filename
 */
function transform(code, filename) {
  const config = getBaseConfig({ bundle: 'esm', outExtension: null, runtimeVersion: '^8.0.0' });

  return transformSync(code, { ...config, babelrc: false, configFile: false, filename })?.code;
}

describe('getBaseConfig', () => {
  // The React preset is scoped off `.ts` files so Babel 8 doesn't turn the JSX parser on for
  // them, which would misparse generic arrows. Its pure annotations must survive that.
  it.each(['x.ts', 'x.tsx', 'x.mts', 'x.cts'])('annotates pure React calls in %s', (filename) => {
    const code = transform(
      `import * as React from 'react';\nexport const C = React.createContext(undefined);\n`,
      filename,
    );

    expect(code).toContain('/*#__PURE__*/React.createContext');
  });

  it('parses generic arrows in plain TypeScript', () => {
    const code = transform(`export const identity = <T = unknown,>(value: T) => value;\n`, 'x.ts');

    expect(code).toContain('identity');
  });
});
