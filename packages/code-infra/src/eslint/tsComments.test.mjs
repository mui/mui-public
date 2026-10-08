import { ESLint } from 'eslint';
import { defineConfig } from 'eslint/config';
import { describe, expect, it } from 'vitest';
import { baseSpecRules, createBaseConfig, createTestConfig } from '@mui/internal-code-infra/eslint';

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: defineConfig(
    ...createBaseConfig(),
    { files: ['**/*.test.ts'], extends: createTestConfig() },
    baseSpecRules,
  ),
});

describe.each(['source.ts', 'source.test.ts', 'source.spec.ts'])('%s', (filePath) => {
  it.each(['', 'bad types'])('rejects an insufficient description: "%s"', async (description) => {
    const [result] = await eslint.lintText(
      `// @ts-expect-error ${description}\nexport const value: string = 1;\n`,
      { filePath },
    );

    expect(result.messages).toEqual([
      expect.objectContaining({
        ruleId: '@typescript-eslint/ban-ts-comment',
        severity: 2,
        messageId: 'tsDirectiveCommentRequiresDescription',
      }),
    ]);
  });

  it.each(['type error', 'Deliberately assign a number to test rejection of invalid input.'])(
    'accepts an explanation of at least 10 characters: "%s"',
    async (description) => {
      const [result] = await eslint.lintText(
        `// @ts-expect-error ${description}\nexport const value: string = 1;\n`,
        { filePath },
      );

      expect(result.messages).toEqual([]);
    },
  );

  it('rejects ts-ignore even with an explanation', async () => {
    const [result] = await eslint.lintText(
      '// @ts-ignore Deliberately assign a number to test rejection of invalid input.\nexport const value: string = 1;\n',
      { filePath },
    );

    expect(result.messages).toEqual([
      expect.objectContaining({
        ruleId: '@typescript-eslint/ban-ts-comment',
        severity: 2,
        messageId: 'tsIgnoreInsteadOfExpectError',
      }),
    ]);
  });
});
