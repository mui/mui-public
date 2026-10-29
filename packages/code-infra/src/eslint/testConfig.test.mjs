import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ESLint } from 'eslint';
import { describe, it, expect } from 'vitest';
import { makeTempDir, writePackage } from '../utils/testUtils.mjs';
import { createBaseConfig, createTestConfig } from './index.mjs';

/**
 * Lints `code` as a test file with the base and test configs, and returns the reported rule ids.
 * @param {string} code
 */
async function lintTestFile(code) {
  const cwd = await makeTempDir();
  // Read by eslint-plugin-import to classify imports.
  await writePackage(cwd, '.', { name: 'my-package' });
  // Read by eslint-plugin-compat in the base config.
  await fs.writeFile(path.join(cwd, '.browserslistrc'), '[stable]\nchrome 120\n');
  const filePath = path.join(cwd, 'example.test.js');
  await fs.writeFile(filePath, code);

  const eslint = new ESLint({
    cwd,
    overrideConfigFile: true,
    overrideConfig: [
      ...createBaseConfig({ baseDirectory: cwd, markdown: false }),
      ...createTestConfig(),
    ],
  });
  const [result] = await eslint.lintFiles([filePath]);
  return result.messages.map((message) => message.ruleId);
}

/**
 * @param {string} expectCall
 */
function testFileWith(expectCall) {
  return `import { it, expect } from 'vitest';\n\nit('works', () => {\n  ${expectCall};\n});\n`;
}

describe('createTestConfig', () => {
  it('allows a non-literal failure message as the second argument of expect', async () => {
    expect(
      await lintTestFile(testFileWith("const message = 'message';\n  expect(1, message).toBe(1)")),
    ).not.toContain('vitest/valid-expect');
  });

  it('reports expect calls with more than two arguments', async () => {
    expect(await lintTestFile(testFileWith("expect(1, 'message', 'extra').toBe(1)"))).toContain(
      'vitest/valid-expect',
    );
  });
});
