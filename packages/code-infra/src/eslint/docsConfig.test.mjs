import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ESLint } from 'eslint';
import { defineConfig } from 'eslint/config';
import { expect, it } from 'vitest';
import { createBaseConfig } from './baseConfig.mjs';
import { createDocsConfig } from './docsConfig.mjs';

it('rejects deprecated APIs in typed and JavaScript docs, without enabling the rule outside docs', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'mui-docs-eslint-'));
  try {
    await fs.mkdir(path.join(directory, 'docs'));
    await fs.writeFile(path.join(directory, '.browserslistrc'), 'defaults');
    await fs.writeFile(
      path.join(directory, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { allowJs: true, checkJs: true, jsx: 'preserve' },
        include: ['**/*'],
      }),
    );
    await fs.writeFile(
      path.join(directory, 'api.ts'),
      '/** @deprecated Use currentApi instead. */\nexport function oldApi() {}\nexport function currentApi() {}\n',
    );
    await Promise.all(
      ['ts', 'tsx', 'js', 'jsx'].map((extension) =>
        fs.writeFile(
          path.join(directory, 'docs', `example-${extension}.${extension}`),
          "import { oldApi, currentApi } from '../api';\noldApi();\ncurrentApi();\n",
        ),
      ),
    );
    await fs.writeFile(
      path.join(directory, 'source.ts'),
      "import { oldApi } from './api';\noldApi();\n",
    );

    const eslint = new ESLint({
      cwd: directory,
      overrideConfigFile: true,
      overrideConfig: defineConfig([
        ...createBaseConfig({ baseDirectory: directory, markdown: false }),
        { files: ['docs/**/*'], extends: createDocsConfig({ baseDirectory: directory }) },
      ]),
    });
    const results = await eslint.lintFiles(['docs', 'source.ts']);
    expect(results.flatMap((result) => result.messages.filter((message) => message.fatal))).toEqual(
      [],
    );
    const deprecations = (result) =>
      result.messages.filter((message) => message.ruleId === '@typescript-eslint/no-deprecated');
    const docs = results.filter((result) => path.dirname(result.filePath).endsWith('/docs'));
    expect(docs).toHaveLength(4);
    expect(docs.map((result) => deprecations(result))).toEqual(
      Array.from({ length: 4 }, () => [
        expect.objectContaining({ severity: 2, line: 2, messageId: 'deprecatedWithReason' }),
      ]),
    );
    expect(
      deprecations(results.find((result) => path.basename(result.filePath) === 'source.ts')),
    ).toEqual([]);
    expect(results).toHaveLength(5);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
