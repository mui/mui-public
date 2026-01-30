import * as fs from 'fs';
import * as path from 'path';
import { transformSync } from '@babel/core';
import { pluginTester } from 'babel-plugin-tester';
import { expect, describe, it } from 'vitest';
import * as babel from '@babel/core';
import plugin from './index';

const fixturePath = path.resolve(__dirname, './__fixtures__');

/**
 *
 * @param {string} fixture
 * @param {string} file
 * @returns {string}
 */
function readOutputFixtureSync(fixture, file) {
  // babel hardcodes the linefeed to \n
  return fs
    .readFileSync(path.join(fixturePath, fixture, file), { encoding: 'utf8' })
    .replace(/\r?\n/g, '\n');
}

pluginTester({
  plugin,
  pluginName: 'minify-errors',
  filepath: __filename,
  tests: [
    {
      title: 'literal',
      pluginOptions: {
        errorCodesPath: path.join(fixturePath, 'literal', 'error-codes.json'),
        runtimeModule: '@mui/utils/formatMuiErrorMessage',
      },
      fixture: path.join(fixturePath, 'literal', 'input.js'),
      output: readOutputFixtureSync('literal', 'output.js'),
    },
    {
      title: 'type-error',
      pluginOptions: {
        errorCodesPath: path.join(fixturePath, 'type-error', 'error-codes.json'),
        runtimeModule: '@mui/utils/formatMuiErrorMessage',
      },
      fixture: path.join(fixturePath, 'type-error', 'input.js'),
      output: readOutputFixtureSync('type-error', 'output.js'),
    },
    {
      title: 'interpolation',
      pluginOptions: {
        errorCodesPath: path.join(fixturePath, 'interpolation', 'error-codes.json'),
        runtimeModule: '@mui/utils/formatMuiErrorMessage',
      },
      fixture: path.join(fixturePath, 'interpolation', 'input.js'),
      output: readOutputFixtureSync('interpolation', 'output.js'),
    },
    {
      title: 'annotates missing error codes',
      pluginOptions: {
        errorCodesPath: path.join(fixturePath, 'no-error-code-annotation', 'error-codes.json'),
        runtimeModule: '@mui/utils/formatMuiErrorMessage',
      },
      fixture: path.join(fixturePath, 'no-error-code-annotation', 'input.js'),
      output: readOutputFixtureSync('no-error-code-annotation', 'output.js'),
    },
    {
      title: 'annotates unminifyable errors',
      pluginOptions: {
        errorCodesPath: path.join(fixturePath, 'unminifyable-annotation', 'error-codes.json'),
        runtimeModule: '@mui/utils/formatMuiErrorMessage',
      },
      fixture: path.join(fixturePath, 'unminifyable-annotation', 'input.js'),
      output: readOutputFixtureSync('unminifyable-annotation', 'output.js'),
    },
    {
      title: 'collects unminifyable errors as Error objects without throwing',
      fixture: path.join(fixturePath, 'unminifyable-collect', 'input.js'),
      pluginOptions: {
        collectErrors: new Set(),
      },
    },
    {
      title: 'uses custom runtime module',
      pluginOptions: {
        errorCodesPath: path.join(fixturePath, 'custom-runtime', 'error-codes.json'),
        runtimeModule: '@custom/error-formatter',
      },
      fixture: path.join(fixturePath, 'custom-runtime', 'input.js'),
      output: readOutputFixtureSync('custom-runtime', 'output.js'),
    },
    {
      title: 'uses custom runtime module with imports',
      pluginOptions: {
        errorCodesPath: path.join(fixturePath, 'custom-runtime-imports', 'error-codes.json'),
        runtimeModule: '#error-formatter',
      },
      fixture: path.join(fixturePath, 'custom-runtime-imports', 'input.js'),
      output: readOutputFixtureSync('custom-runtime-imports', 'output.js'),
    },
    {
      title: 'uses custom runtime module with relative path',
      pluginOptions: {
        errorCodesPath: path.join(
          fixturePath,
          'custom-runtime-imports-relative',
          'error-codes.json',
        ),
        runtimeModule: '#error-formatter',
      },
      fixture: path.join(fixturePath, 'custom-runtime-imports-relative', 'input.js'),
      output: readOutputFixtureSync('custom-runtime-imports-relative', 'output.js'),
    },
    {
      title: 'uses custom runtime module with recursive imports',
      pluginOptions: {
        errorCodesPath: path.join(
          fixturePath,
          'custom-runtime-imports-recursive',
          'error-codes.json',
        ),
        runtimeModule: '#error-formatter',
      },
      fixture: path.join(fixturePath, 'custom-runtime-imports-recursive', 'input.js'),
      output: readOutputFixtureSync('custom-runtime-imports-recursive', 'output.js'),
    },
    {
      title: 'skips errors inside dev-only branches',
      pluginOptions: {
        errorCodesPath: path.join(fixturePath, 'dev-only-branch', 'error-codes.json'),
        runtimeModule: '@mui/utils/formatMuiErrorMessage',
        detection: 'opt-out',
      },
      fixture: path.join(fixturePath, 'dev-only-branch', 'input.js'),
      output: readOutputFixtureSync('dev-only-branch', 'output.js'),
    },
  ],
});

describe('collectErrors', () => {
  it('collects error messages into the provided Set without transforming code', () => {
    const errors = new Set();
    const code = [
      'throw /* minify-error */ new Error("first error");',
      // eslint-disable-next-line no-template-curly-in-string
      'throw /* minify-error */ new Error(`second ${x} error`);',
    ].join('\n');

    transformSync(code, {
      filename: '/test/file.js',
      plugins: [[plugin, { collectErrors: errors }]],
      configFile: false,
      babelrc: false,
    });

    expect(errors).toEqual(new Set(['first error', 'second %s error']));
  });

  it('collects Error objects for unminifyable errors', () => {
    const errors = new Set();
    const code = [
      'throw /* minify-error */ new Error(foo);',
      'throw /* minify-error */ new Error(...bar);',
    ].join('\n');

    transformSync(code, {
      filename: '/test/file.js',
      plugins: [[plugin, { collectErrors: errors }]],
      configFile: false,
      babelrc: false,
    });

    const collected = Array.from(errors);
    expect(collected).toHaveLength(2);
    expect(collected[0]).toBeInstanceOf(Error);
    expect(collected[0].message).toMatch(
      /Unminifyable error. You can only use literal strings and template strings as error messages./,
    );
    expect(collected[1]).toBeInstanceOf(Error);
    expect(collected[1].message).toMatch(
      /Unminifyable error. You can only use literal strings and template strings as error messages./,
    );
  });

  it('continues collection past unminifyable errors', () => {
    const errors = new Set();
    const code = [
      'throw /* minify-error */ new Error(foo);',
      'throw /* minify-error */ new Error("valid error message");',
    ].join('\n');

    transformSync(code, {
      filename: '/test/file.js',
      plugins: [[plugin, { collectErrors: errors }]],
      configFile: false,
      babelrc: false,
    });

    const collected = Array.from(errors);
    expect(collected).toHaveLength(2);
    expect(collected[0]).toBeInstanceOf(Error);
    expect(collected[1]).toBe('valid error message');
  });

  it('respects detection option when collecting errors', () => {
    const errors = new Set();
    const code = ['throw new Error("opted-in error");', 'throw new Error("not collected");'].join(
      '\n',
    );

    transformSync(code, {
      filename: '/test/file.js',
      plugins: [[plugin, { collectErrors: errors, detection: 'opt-out' }]],
      configFile: false,
      babelrc: false,
    });

    expect(errors).toEqual(new Set(['opted-in error', 'not collected']));
  });
});

describe('minify-errors double-visitation fix', () => {
  // Separate test for the double-visitation bug fix
  // This test uses @babel/core directly because it requires specific preset configuration
  // that triggers the double-visitation issue (preset-env with modules: 'commonjs' + React.forwardRef)
  it('handles double visitation with preset-env commonjs modules', () => {
    // This pattern (React.forwardRef) combined with @babel/preset-env modules: 'commonjs'
    // causes Babel to visit the same NewExpression node multiple times.
    // Without the fix, this would result in both a FIXME annotation AND a minified error.
    //
    // NOTE: We use detection: 'opt-out' to properly trigger the bug, because with opt-in,
    // the /* minify-error */ comment gets removed on the first pass, which masks the issue.
    const input = `
import * as React from 'react';

export const Component = React.forwardRef(function Component(props, ref) {
  if (!props.store) {
    throw new Error('Component requires a store prop');
  }
  return <div ref={ref}>{props.children}</div>;
});
`;

    const result = babel.transformSync(input, {
      filename: path.join(fixturePath, 'commonjs-double-visit', 'test.js'),
      configFile: false,
      babelrc: false,
      presets: [
        ['@babel/preset-env', { modules: 'commonjs' }],
        ['@babel/preset-react', { runtime: 'automatic' }],
      ],
      plugins: [
        [
          plugin,
          {
            errorCodesPath: path.join(fixturePath, 'commonjs-double-visit', 'error-codes.json'),
            runtimeModule: '@mui/utils/formatMuiErrorMessage',
            detection: 'opt-out', // Use opt-out to properly trigger the bug
          },
        ],
      ],
    });

    // Key assertions:
    // 1. Output should NOT contain FIXME annotation (which would indicate improper double processing)
    expect(result?.code).not.toContain('FIXME');

    // 2. Output should contain the properly minified error with NODE_ENV conditional
    expect(result?.code).toContain('process.env.NODE_ENV !== "production"');

    // 3. Output should contain the error code call (the import name varies based on babel helper)
    expect(result?.code).toMatch(/_formatMuiErrorMessage.*\(1\)/);
  });
});
