import * as path from 'node:path';
import { rolldown } from 'rolldown';
import { describe, expect, it } from 'vitest';

import { babelPlugin } from './babelPlugin.mjs';
import { makeTempFiles } from './testUtils.mjs';

/**
 * @param {Record<string, string>} files
 * @param {string} input
 * @param {import('../cli/packageJson').PackageJson} packageJson
 */
async function build(files, input, packageJson) {
  const cwd = await makeTempFiles(files);
  const bundle = await rolldown({
    cwd,
    input: path.join(cwd, input),
    platform: 'neutral',
    external: [/^[^./]/],
    plugins: [babelPlugin(packageJson)],
  });
  const { output } = await bundle.generate({ format: 'es' });
  return output[0].code;
}

describe('babelPlugin', () => {
  it('applies the MUI Babel plugins Oxc has no equivalent for', async () => {
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
          'export default Button;',
        ].join('\n'),
      },
      'src/index.tsx',
      { name: '@test/example', version: '1.0.0', dependencies: { 'prop-types': '*' } },
    );

    expect(code).toMatch(/\/\*\s*[#@]__PURE__\s*\*\/ React\.createContext/);
    expect(code).toMatch(/Button\.displayName = "Button"/);
    expect(code).toContain('process.env.NODE_ENV !== "production" && (Link.propTypes');
  });

  it('parses .cjs sources as CommonJS', async () => {
    const code = await build(
      { 'src/legacy.cjs': 'if (true) {\n  module.exports = { value: 42 };\n  return;\n}' },
      'src/legacy.cjs',
      { name: '@test/example', version: '1.0.0' },
    );

    expect(code).toContain('value: 42');
  });
});
