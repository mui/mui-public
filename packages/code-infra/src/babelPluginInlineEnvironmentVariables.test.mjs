import { transformSync } from '@babel/core';
import { describe, expect, it } from 'vitest';

import plugin from './babelPluginInlineEnvironmentVariables.mjs';

/**
 * @param {string} code
 * @param {{ include?: string[], exclude?: string[] }} [options]
 */
function transform(code, options) {
  return transformSync(code, {
    babelrc: false,
    configFile: false,
    plugins: [[plugin, options ?? {}]],
  })?.code;
}

describe('babelPluginInlineEnvironmentVariables', () => {
  const ENV_KEY = 'TEST_INLINE_ENV_VAR';
  process.env[ENV_KEY] = 'inlined';

  it('inlines dotted access', () => {
    expect(transform(`const v = process.env.${ENV_KEY};`)).toMatchInlineSnapshot(
      `"const v = "inlined";"`,
    );
  });

  it('inlines computed string access', () => {
    expect(transform(`const v = process.env['${ENV_KEY}'];`)).toMatchInlineSnapshot(
      `"const v = "inlined";"`,
    );
  });

  it('inlines undefined variables as undefined', () => {
    expect(transform(`const v = process.env.TEST_INLINE_ENV_MISSING;`)).toMatchInlineSnapshot(
      `"const v = undefined;"`,
    );
  });

  it('leaves variables outside include untouched', () => {
    const code = `const v = process.env.${ENV_KEY};`;
    expect(transform(code, { include: ['OTHER'] })).toBe(code);
  });

  it('leaves excluded variables untouched', () => {
    const code = `const v = process.env.${ENV_KEY};`;
    expect(transform(code, { exclude: [ENV_KEY] })).toBe(code);
  });

  it('leaves assignment targets untouched', () => {
    const code = `process.env.${ENV_KEY} = 'x';`;
    expect(transform(code)).toBe(code);
  });

  it('ignores non-string computed keys', () => {
    expect(transform(`const v = process.env[key];`)).toMatchInlineSnapshot(
      `"const v = process.env[key];"`,
    );
  });
});
