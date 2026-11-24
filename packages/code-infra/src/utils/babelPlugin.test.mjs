import * as path from 'node:path';
import { rolldown } from 'rolldown';
import { describe, expect, it, vi } from 'vitest';

import { babelPlugin } from './babelPlugin.mjs';
import { makeTempFiles } from './testUtils.mjs';

const BASE_CONFIG = path.join(import.meta.dirname, '../babel-config.mjs');

/**
 * @param {Record<string, string>} files
 * @param {string} input
 */
async function build(files, input) {
  const cwd = await makeTempFiles(files);
  const bundle = await rolldown({
    cwd,
    input: path.join(cwd, input),
    platform: 'neutral',
    external: [/^[^./]/],
    plugins: [babelPlugin(BASE_CONFIG)],
  });
  const { output } = await bundle.generate({ format: 'es' });
  return output[0].code;
}

describe('babelPlugin', () => {
  it('runs the Babel config in oxc mode', async () => {
    vi.stubEnv('MUI_REMOVE_PROP_TYPES', 'true');
    vi.stubEnv('MUI_VERSION', '1.2.3');
    const code = await build(
      {
        'src/index.tsx': [
          "import * as React from 'react';",
          "import PropTypes from 'prop-types';",
          'export const Context = React.createContext(null);',
          'const Button = React.forwardRef<HTMLButtonElement>((props, ref) => <button ref={ref} />);',
          'export function Link(props: { href?: string }) {',
          '  return <a href={props.href} />;',
          '}',
          'Link.propTypes = { href: PropTypes.string };',
          'export const version = process.env.MUI_VERSION;',
          'export default Button;',
        ].join('\n'),
      },
      'src/index.tsx',
    );

    expect(code).toMatch(/\/\*\s*[#@]__PURE__\s*\*\/ React\.createContext/);
    expect(code).toMatch(/Button\.displayName = "Button"/);
    expect(code).toContain('process.env.NODE_ENV !== "production" && (Link.propTypes');
    // tsdown inlines version variables in oxc mode.
    expect(code).toContain('const version = process.env.MUI_VERSION');
  });

  it('parses .cjs sources as CommonJS', async () => {
    const code = await build(
      { 'src/legacy.cjs': 'if (true) {\n  module.exports = { value: 42 };\n  return;\n}' },
      'src/legacy.cjs',
    );

    expect(code).toContain('value: 42');
  });
});
